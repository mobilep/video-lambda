'use strict'

const aws = require('aws-sdk')

const fbAdmin = require('firebase-admin')
const fbServiceAccount = require(process.env.firebaseKeyPath)

fbAdmin.initializeApp({
  credential: fbAdmin.credential.cert(fbServiceAccount),
  databaseURL: process.env.firebaseDatabaseURL
})

const fbDatabase = fbAdmin.database()

exports.process = function (event, context, callback) {
  console.log('Received event:', JSON.stringify(event, null, 2))

  const srcBucket = event.Records[0].s3.bucket.name
  const srcKey = event.Records[0].s3.object.key
  const size = event.Records[0].s3.object.size

  // constant
  const imageSizeMax = 10485760 // 10 MB

  // Firebase: status INIT
  const imageId = srcKey.match(/\/(.*?)\./)[1]
  const typeMatch = srcKey.match(/\.([^.]*)$/)
  const suffix = typeMatch[0]
  const imageRef = fbDatabase.ref('images').child(imageId)
  imageRef.set({ imageId, state: 'PROCESSING' })

  // get reference to S3 client
  const s3 = new aws.S3()

  const params = {
    Bucket: srcBucket,
    CopySource: srcBucket + '/uploads/' + imageId + suffix,
    Key: 'public/' + 'images/' + imageId + suffix
  }

  if (size > imageSizeMax) {
    return console.error('image size is too big')
  }

  console.log('Copy params: ' + JSON.stringify(params))

  s3.copyObject(params,
    (err, response) => {
      if (err) {
        imageRef.set({ imageId, state: 'ERROR' })
        console.error('unable to copy image ' + err)
      } else {
        imageRef.set({ imageId, state: 'COMPLETED', size })
      }
    })
}