'use strict' 

const aws = require('aws-sdk')

const fbAdmin = require('firebase-admin')
const fbServiceAccount = require(process.env.firebaseKeyPath)

fbAdmin.initializeApp({
    credential: fbAdmin.credential.cert(fbServiceAccount),
    databaseURL: process.env.firebaseDatabaseURL
  })
  
const fbDatabase = fbAdmin.database()

exports.process = function (event) {
  console.log('Received event:', JSON.stringify(event, null, 2))

  const srcBucket = event.Records[0].s3.bucket.name
  const srcKey = event.Records[0].s3.object.key
  const size = event.Records[0].s3.object.size

  // constant
  const fileSizeMax = 104857600 // 100 MB

  // Firebase: status INIT
  const fileId = srcKey.match(/\/(.*?)\./)[1]
  const suffix = srcKey.match(/\..*/)[0]
  const fileRef = fbDatabase.ref('files').child(fileId)

  // get reference to S3 client
  const s3 = new aws.S3()

  const params = {
    Bucket: srcBucket,
    CopySource: srcBucket + '/uploads/' + fileId + suffix,
    Key: 'files' + '/' + fileId + suffix
  }
 
  if (size > fileSizeMax) {
    console.error('file size is too big')
    return
  }

  console.log('Copy params: ' + JSON.stringify(params))

  s3.copyObject(params,
    (err, response) => {
      if (err) {
        fileRef.set({ fileId, state: 'ERROR' })
        console.error('unable to copy file ' + err)
      } else {
        fileRef.set({ fileId, size, fileName: fileId + suffix, link: params.Key, state: 'COMPLETED' })
      }
    })
}