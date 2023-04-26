'use strict'

const AWS = require('aws-sdk')
const sharp = require('sharp')

const fbAdmin = require('firebase-admin')
const fbServiceAccount = require(process.env.firebaseKeyPath)

fbAdmin.initializeApp({
  credential: fbAdmin.credential.cert(fbServiceAccount),
  databaseURL: process.env.firebaseDatabaseURL
})

const fbDatabase = fbAdmin.database()

// constants
const SIZES = [100, 640, 1024]

exports.process = async (event, context, callback) => {
  console.log('Reading options from event:\n', JSON.stringify(event, null, 2))
    const srcBucket = event.Records[0].s3.bucket.name
    const srcKey = event.Records[0].s3.object.key
    const region = event.Records[0].awsRegion
    const dstBucket = srcBucket


    // Firebase: status INIT
    const imageId = srcKey.match(/\/(.*?)\./)[1]
    const imageRef = fbDatabase.ref('images').child(imageId)
  try {
    await imageRef.set({ imageId, state: 'PROCESSING' })

    // get reference to S3 client
    const s3 = new AWS.S3({ region })

    console.log('S3 configured with endpoint ' + s3.endpoint.href)

    validateInput(srcKey, imageRef, imageId)

    // Download the image from S3
    const response = await s3.getObject({ Bucket: srcBucket, Key: srcKey }).promise()
    const imgBuf = response.Body

    const promises = []
    SIZES.forEach(maxSize => {
      promises.push(transformImg(maxSize, imgBuf, imageId, dstBucket, s3))
    })

    await Promise.all(promises)

    await imageRef.set({ imageId, state: 'COMPLETED' })
    console.log(
      'Successfully resized ' + srcBucket
    )
  } catch (err) {
    await imageRef.set({ imageId, state: 'ERROR' })
    console.error(
      'Unable to resize ' + srcBucket +
      ' due to an error: ' + err
    )
    return err
  }
}

const validateInput = (srcKey, imageRef, imageId) => {
  const typeMatch = srcKey.match(/\.([^.]*)$/)
  if (!typeMatch) {
    imageRef.set({ imageId, state: 'ERROR' })
    throw new Error(`Can not detect file ext for key "${srcKey}"`)
  }

  const imgExt = typeMatch[1].toLowerCase()
  const validImgExtList = ['jpg', 'jpeg', 'png']
  if (!validImgExtList.includes(imgExt)) {
    imageRef.set({ imageId, state: 'ERROR' })
    throw new Error(`Unsupported image ext "${imgExt}" for key "${srcKey}"`)
  }
}

const resizePhoto = (maxSize, imgBuf) => {
  const img = sharp(imgBuf)
    return img.metadata()
      .then((metadata) => {
        const {width: originalWidth, height: originalHeight} = metadata
        console.log(`[IMAGE_CONVERTER] original: ${originalWidth} * ${originalHeight}`)

        const scalingFactor = Math.max(
          maxSize / originalWidth,
          maxSize / originalHeight
        )
        console.log(`[IMAGE_CONVERTER] scaling factor : ${scalingFactor}`)

        if (scalingFactor > 1) {
          return imgBuf
        }

        const width = Math.round(scalingFactor * originalWidth)
        const height = Math.round(scalingFactor * originalHeight)

        console.log(`[IMAGE_CONVERTER] result: ${width} * ${height}`)
        return img
          .resize(width, height)
          .toBuffer()
      })
}

const upload = (dstBucket, dstKey, data, s3) => {
  // Stream the transformed image to a different S3 bucket.
  return s3.putObject({
      Bucket: dstBucket,
      Key: dstKey,
      Body: data,
      ContentType: 'image/jpeg'
    }).promise()
}

const rotate = (imgBuf) => {
  return sharp(imgBuf)
    .rotate()
    .toBuffer()
}

const transformImg = async (maxSize, imgBuf, imageId, dstBucket, s3) => {
  const dstKey = 'public/' + maxSize + '/' + imageId + '.jpg'
  const resizedImg = await resizePhoto(maxSize, imgBuf)
  const rotatedImg = await rotate(resizedImg)
  await upload(dstBucket, dstKey, rotatedImg, s3)
}

