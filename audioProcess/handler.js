'use strict'

const AWS = require('aws-sdk')
const util = require('util')
const fbAdmin = require('firebase-admin')

const elasticTranscoder = new AWS.ElasticTranscoder()
const constVars = require('./const')

// init firebase
const fbServiceAccount = require(process.env.firebaseKeyPath)
fbAdmin.initializeApp({
  credential: fbAdmin.credential.cert(fbServiceAccount),
  databaseURL: process.env.firebaseDatabaseURL
})
const fbDatabase = fbAdmin.database()

exports.process = async (event) => {
  try {
    console.log('Received event:', JSON.stringify(event, null, 2))
    const key = event.Records[0].s3.object.key
    const size = event.Records[0].s3.object.size

    const fileKey = key.split('/').pop().split('.').shift()

    const fbRef = fbDatabase.ref('audios').child(fileKey)
    await _createTranscoderJobMP3(key);

    return await fbRef.set({audioId: fileKey, state: constVars.STATE.PROCESSING, size: size})
  } catch (e) {
    console.error(e);
    return e;
  }
}

/**
 *
 * @param {Object} event
 * @param {Object[]} event.Records
 * @param {Object} event.Records[].Sns
 * @param {string} event.Records[].Sns.Message

 * @returns {Promise<*>}
 */
exports.processed = async (event) => {
  try {
    /**
     * @const {Object} message
     * @const {string} message.outputKeyPrefix
     * @const {Object[]} message.outputs
     * @const {string} message.outputs[].key
     */
    const message = JSON.parse(event.Records[0].Sns.Message)
    // console.log('TranscoderJobCompleted', util.inspect(message, {showHidden: true, depth: null}))
    const key = message.input.key
    const fileKey = key.split('/').pop().split('.').shift()

    const fbRef = fbDatabase.ref('audios').child(fileKey)

    let data = {
      audioId: fileKey
    }

    const playPath = message.outputKeyPrefix + message.outputs[0].key
    if (message.state === constVars.STATE.COMPLETED) {
      data = {state: constVars.STATE.COMPLETED, playPath}
    } else {
      console.error(message)
      data = {status: constVars.STATE.ERROR}
    }

    await fbRef.update(data)
  } catch (e) {
    console.error(e);
    return e;
  }
}

function _createTranscoderJobMP3 (key) {
  return new Promise((resolve, reject) => {
    const outputPrefix = `${_baseName(key)}`
    const params = {
      Input: {
        Key: key
      },
      PipelineId: process.env.pipelineId, /*Your Elastic Transcoder Pipeline Id*/
      OutputKeyPrefix: process.env.folder + '/mp3/' + outputPrefix,
      Outputs: [
        {
          Key: '/output/320k.mp3',
          PresetId: '1351620000001-300010',
        },
      ],
    }

    elasticTranscoder.createJob(params, function (err, data) {
      if (err) {
        console.error(err, err.stack)
        return reject(err)
      } // an error occurred
      else {
        console.log('TranscoderJob', util.inspect(data, {showHidden: true, depth: null}))
        return resolve(data)
      }         // successful response
    })
  })
}


/**
 * other private functions
 */

// return filename without extension
function _baseName (path) {
  return path.split('/').reverse()[0].split('.')[0]
}