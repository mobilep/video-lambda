'use strict'

const aws = require('aws-sdk')
const util = require('util')
const elastictranscoder = new aws.ElasticTranscoder()
const s3 = new aws.S3({params: {Bucket: process.env.BUCKET}});
const constVars = require('./const')
const Promise = require('bluebird')

const fbAdmin = require('firebase-admin')
const fbServiceAccount = require(process.env.firebaseKeyPath)

fbAdmin.initializeApp({
  credential: fbAdmin.credential.cert(fbServiceAccount),
  databaseURL: process.env.firebaseDatabaseURL
})

const fbDatabase = fbAdmin.database()

// return filename without extension
function _baseName (path) {
  return path.split('/').reverse()[0].split('.')[0]
}

exports.process = function (event, context, callback) {
  context.callbackWaitsForEmptyEventLoop = false

  console.log('Received event:', JSON.stringify(event, null, 2))
  const key = event.Records[0].s3.object.key
  const size = event.Records[0].s3.object.size

  const fileKey = key.split('/').pop().split('.').shift()
  const fileExt = key.split('/').pop().split('.').pop()

  const videoRef = fbDatabase.ref('videos').child(fileKey)

  return Promise.all([_createTranscoderJobMpegDash(key),_createTranscoderJobHLS(key)])
    .then(() => {
      return videoRef.set({
        videoId: fileKey,
        state: constVars.STATE.PROCESSING,
        size: size,
        ext: fileExt
      })
    }).catch((err) => {
      console.log('Firebase error', err)
    }).finally(() => {
      return callback()
    })

}

exports.processed = function (event, context) {
  const message = JSON.parse(event.Records[0].Sns.Message)

  const key = message.input.key
  const fileKey = key.split('/').pop().split('.').shift()

  const videoRef = fbDatabase.ref('videos').child(fileKey)

  let data = {}
  const outputKeyPrefix = message.outputKeyPrefix
  const playPath = outputKeyPrefix + message.playlists[0].name
  const thumbPath = outputKeyPrefix + '/thumbs/00001.png'
  if (message.state === constVars.STATE.COMPLETED) {
    data = {videoId: fileKey, state: constVars.STATE.COMPLETED, playPath: playPath, thumbPath: thumbPath}
    if (playPath.indexOf('HLS') >= 0) {
      data.playPathHLS = playPath
      data.thumbPathHLS = thumbPath
    } else {
      data.playPathDASH = playPath
      data.thumbPathDASH = thumbPath
    }
  } else {
    console.log(message)
    // run without audio HLS
    if (message.playlists[0] && message.playlists[0].status === 'Error'
    && message.playlists[1] && message.playlists[1].status !== 'Error'
    ) {
      console.log(message.playlists[1])

      data = {
        videoId: fileKey,
        state: constVars.STATE.COMPLETED,
        playPath: playPath,
        thumbPath: thumbPath
      }

      if (playPath.indexOf('HLS') >= 0) {
        var params2 = {
          CopySource: process.env.BUCKET + '/' + outputKeyPrefix + message.playlists[1].name + '.m3u8',
          Key: outputKeyPrefix + message.playlists[0].name + '.m3u8'
        };
        s3.copyObject(params2, function(copyErr, copyData){
          if (copyErr) {
            console.log(copyErr);
          }
        });
        data.playPathHLS = playPath
        data.thumbPathHLS = thumbPath
      } else {
        var params1 = {
          CopySource: process.env.BUCKET + '/' + outputKeyPrefix + message.playlists[1].name + '.mpd',
          Key: outputKeyPrefix + message.playlists[0].name + '.mpd'
        };
        s3.copyObject(params1, function(copyErr, copyData){
          if (copyErr) {
            console.log(copyErr);
          }
        });
        data.playPathDASH = playPath
        data.thumbPathDASH = thumbPath
      }

    } else {
      data = {videoId: fileKey, status: 'error'}
    }
  }

  return videoRef.update(data)
    .then(() => {
        return context.succeed()
      }
    )

}

function _createTranscoderJobHLS (key) {
  return new Promise((resolve, reject) => {
    const outputPrefix = _baseName(key) // + '-' + Date.now().toString();
    // const watermark = [{
    //   InputKey: process.env.watermarkPath,
    //   PresetWatermarkId: 'BottomRight'
    // }]

    const params = {
      Input: {
        Key: key
      },
      PipelineId: process.env.pipelineId, /*Your Elastic Transcoder Pipeline Id*/
      OutputKeyPrefix: 'HLS/' + outputPrefix,
      Outputs: [
        {
          Key: '/output/2M',
          PresetId: process.env.customPresetId, // HLS v3 and v4 (Apple HTTP Live Streaming), 2 megabits/second, Video-only
          SegmentDuration: '10',
          //  Watermarks: watermark,
          ThumbnailPattern: '/thumbs/{count}'
        },
        // {
        //   Key: '/output/15M',
        //   PresetId: '1351620000001-200025', // HLS v3 and v4 (Apple HTTP Live Streaming), 1.5 megabits/second, Video-only
        //   //  Watermarks: watermark,
        //   SegmentDuration: '10'
        // },
        // {
        //   Key: '/output/1M',
        //   PresetId: '1351620000001-200035', // HLS v3 and v4 (Apple HTTP Live Streaming), 1 megabit/second, Video-only
        //   //  Watermarks: watermark,
        //   SegmentDuration: '10'
        // },
        // {
        //   Key: '/output/600k',
        //   PresetId: '1351620000001-200045', // HLS v3 and v4 (Apple HTTP Live Streaming), 600 kilobits/second, Video-only
        //   //  Watermarks: watermark,
        //   SegmentDuration: '10'
        // },
        // {
        //   Key: '/output/400k',
        //   PresetId: '1351620000001-200055', // HLS v3 and v4 (Apple HTTP Live Streaming), 400 kilobits/second, Video-only
        //   //  Watermarks: watermark,
        //   SegmentDuration: '10'
        // },
        {
          Key: '/output/aud',
          PresetId: '1351620000001-200060', // AUDIO ONLY: HLS v3 and v4 Audio, 160 k
          SegmentDuration: '10'
        }
      ],
      Playlists: [
        {
          Format: 'HLSv4',
          Name: '/playlist',
          //Name:  '/' + _baseName(key) + '-master-playlist',
          OutputKeys: [//'/output/1M', '/output/600k', '/output/400k','/output/15M'
           '/output/aud',  '/output/2M']
        },
        {
          Format: 'HLSv4',
          Name: '/playlist-vid',
          //Name:  '/' + _baseName(key) + '-master-playlist',
          OutputKeys: [//,  '/output/1M', '/output/600k', '/output/400k','/output/15M'
          '/output/2M'
          ]
        }
      ]
    }

    elastictranscoder.createJob(params, function (err, data) {
      if (err) {
        console.log(err, err.stack)
        return reject(err)
      } // an error occurred
      else {
        console.log('TranscoderJob', util.inspect(data, {showHidden: true, depth: null}))
        return resolve(data)
      }         // successful response
    })
  })
}

function _createTranscoderJobMpegDash (key) {
  return new Promise((resolve, reject) => {
    const outputPrefix = _baseName(key)
    const params = {
      Input: {
        Key: key
      },
      PipelineId: process.env.pipelineId, /*Your Elastic Transcoder Pipeline Id*/
      OutputKeyPrefix: 'MPEG-DASH/' + outputPrefix,
      Outputs: [
        {
          Key: '/output/24M',
          PresetId: '1351620000001-500030',
          SegmentDuration: '4',
          ThumbnailPattern: '/thumbs/{count}'
        },
        // {
        //   Key: '/output/12M',
        //   PresetId: '1351620000001-500040',
        //   SegmentDuration: '4'
        // },
        // {
        //   Key: '/output/600k',
        //   PresetId: '1351620000001-500050',
        //   SegmentDuration: '4'
        // },
        {
          Key: '/output/aud',
          PresetId: '1351620000001-500060',
          SegmentDuration: '4'
        }
      ],
      Playlists: [
        {
          Format: 'MPEG-DASH',
          Name: '/playlist',
          OutputKeys: [//,'/output/12M','/output/600k', 
          '/output/24M','/output/aud']
        },
        {
          Format: 'MPEG-DASH',
          Name: '/playlist-vid',
          OutputKeys: [//,'/output/12M','/output/600k'
          '/output/24M']
        }
      ]
    }

    elastictranscoder.createJob(params, function (err, data) {
      if (err) {
        console.log(err, err.stack)
        return reject(err)
      } // an error occurred
      else {
        console.log('TranscoderJob', util.inspect(data, {showHidden: true, depth: null}))
        return resolve(data)
      }         // successful response
    })
  })
}
