'use strict'

const aws = require('aws-sdk')
const util = require('util')
const mongoose = require('mongoose')
const intercomeModel = require('intercom.model')
const Intercom = require('intercom-client')
const Promise = require('bluebird')

module.exports.import = (event, context, callback) => {
  mongoose.Promise = Promise
  const mongoUri = require(process.env.mongoUri)
  const db = mongoose.connect(mongoUri).connection
  Intercom.client = new Intercom.Client({
    token: process.env.intercomeToken
  })
  const client = Intercom.client
  const iterationIds = []
  db.once('open', () => {
    intercomeModel
      .find({isActive: true})
      .limit(480)
      .then((results) => {
        if (results.length > 0) {
          const importPromises = []
          results.forEach((result) => {
            iterationIds.push(result._id)
            importPromises.push(client[result.type][result.action](result.body))
          })
          return Promise.all(importPromises)
        } else {
          return null
        }
      })
      .then(() => {
        if (iterationIds.length > 0) {
          return intercomeModel.update(
            {_id: {$in: iterationIds}},
            {$set: {isActive: false}},
            {multi: true})
        } else {
          return null
        }
      })
      .then(() => {
        return callback()
      })
      .catch((err) => {
        console.log(err)
        callback(null)
      })
      .finally(() => {
        // Close db connection or node event loop won't exit , and lambda will timeout
        db.close()
      })
  })
}
