'use strict'

const async = require('async')
const AWS = require('aws-sdk')
const gm = require('gm')
  .subClass({
    imageMagick: true
  }) // Enable ImageMagick integration.
const util = require('util')

const fbAdmin = require('firebase-admin')
const fbServiceAccount = require(process.env.firebaseKeyPath)

fbAdmin.initializeApp({
  credential: fbAdmin.credential.cert(fbServiceAccount),
  databaseURL: process.env.firebaseDatabaseURL
})

const fbDatabase = fbAdmin.database()

// constants
const SIZES = [100, 640, 1024]

exports.process = (event, context, callback) => {
  // Read options from the event.
  console.log('Reading options from event:\n', util.inspect(event, {
    depth: 5
  }))
  const srcBucket = event.Records[0].s3.bucket.name
  const srcKey = event.Records[0].s3.object.key
  const region = event.Records[0].awsRegion
  const dstBucket = srcBucket

  const typeMatch = srcKey.match(/\.([^.]*)$/)

  // Firebase: status INIT
  const imageId = srcKey.match(/\/(.*?)\./)[1];
  const imageRef = fbDatabase.ref('images').child(imageId)
  imageRef.set({imageId, state: 'PROCESSING'})

  // get reference to S3 client
  const s3 = new AWS.S3({
    region: region
  })

  console.log('S3 configured with endpoint ' + s3.endpoint.href)

  // Infer the image type.

  if (!typeMatch) {
    console.error('unable to infer image type for key ' + srcKey)
    imageRef.set({imageId, state: 'ERROR'})
    return callback()
  }
  const imageType = typeMatch[1].toLowerCase()
  if (
    imageType !== 'jpg'
    && imageType !== 'jpeg' 
    && imageType !== 'png'
  ) {
    console.log('skipping non-image ' + srcKey)
    return callback()
  }

  // Download the image from S3
  s3.getObject({
      Bucket: srcBucket,
      Key: srcKey
    },
    (err, response) => {

      if (err)
        return console.error('unable to download image ' + err)

      const contentType = response.ContentType

      const original = gm(response.Body)

      original.size((err, size) => {

        if (err)
          return console.error(err)

        //transform, and upload to a different S3 bucket.
        async.each(SIZES,
          (max_size, callback) => {
            resize_photo(size, max_size, imageType, original, srcKey, dstBucket, contentType, s3, callback)
          },
          (err) => {
            // Firebase: status INIT
            const imageRef = fbDatabase.ref('images').child(imageId)
            if (err) {

              imageRef.set({imageId, state: 'ERROR'})

              console.error(
                'Unable to resize ' + srcBucket +
                ' due to an error: ' + err
              )
            } else {
              imageRef.set({imageId, state: 'COMPLETED'})
              console.log(
                'Successfully resized ' + srcBucket
              )
            }
            callback()
          })
      })

    })
}

//wrap up variables into an options object
const resize_photo = (size, max_size, imageType, original, srcKey, dstBucket, contentType, s3, done) => {

  const parts = srcKey.split('/')
  const filename = parts[parts.length - 1]
  let dstKey = 'public/' + max_size + '/' + filename

  const fileId = filename.split('.')[0];

  console.log('Creating version ' + dstKey)

  // transform, and upload to a different S3 bucket.
  async.waterfall([

    function transform (next) {
      if (max_size === 'full') {
        original.toBuffer(imageType, (err, buffer) => {
          next(null, buffer)
        })
        return
      }

      // Infer the scaling factor to avoid stretching the image unnaturally.
      // We use Math.max because we want to fill the smallest side
      const scalingFactor = Math.max(
        max_size / size.width,
        max_size / size.height
      )

      // No need to waste resources upscaling.
      if (scalingFactor > 1) {
        original.toBuffer(imageType, (err, buffer) => {
          next(null, buffer)
        })
        return
      }
      const width = scalingFactor * size.width
      const height = scalingFactor * size.height

      // Transform the image buffer in memory.
      original.resize(width, height)
        .toBuffer(imageType, (err, buffer) => {

          if (err) {
            next(err)
          } else {
            next(null, buffer)
          }
        })
    },
    function orientation (response, next) {
      if (imageType === 'png') {
        //next(null, response)
        // var writeStream = fs.createWriteStream("output.jpg");
        imageType = 'jpg';
        dstKey = 'public/' + max_size + '/' + fileId + '.' + imageType;
        gm(response).toBuffer('jpeg', (err, buffer) => {
          console.log(err);
          if (err) {
            next(err)
          } else {
            next(null, buffer)
          }
        })
      } else {
        var self = gm(response);
        dstKey = 'public/' + max_size + '/' + fileId + '.' + imageType;
        gm(response).orientation((err, value) => {
          console.log('***ORIENTATION**', err, value)
          let toRotate = 0
          if (value === 'RightTop') {
            toRotate = 90
          }
          if (value === 'BottomRight') {
            toRotate = 180
          }
          if (value === 'LeftBottom') {
            toRotate = 270
          }
          self.noProfile().rotate('white', toRotate).toBuffer(imageType, (err, buffer) => {
            if (err) {
              next(err)
            } else {
              next(null, buffer)
            }
          })
        })
      }

    },
    function upload (data, next) {
      // Stream the transformed image to a different S3 bucket.
      s3.putObject({
          Bucket: dstBucket,
          Key: dstKey,
          Body: data,
          ContentType: 'image/jpeg'
        },
        next)
    }
  ], function (err) {

    console.log('finished resizing ' + dstBucket + '/' + dstKey)

    if (err) {
      console.error(err)
    } else {
      console.log(
        'Successfully resized ' + dstKey
      )
    }
    done(err)
  })
}