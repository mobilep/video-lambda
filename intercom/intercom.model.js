'use strict'

const mongoose = require('mongoose')
const Schema = mongoose.Schema
/**
 * @apiDefine user User access only
 * This optional description belong to the group user.
 */
const intercom = new Schema({
  type: {type: String, enum: ['companies', 'users', 'events']},
  action: {type: String, enum: ['create', 'update', 'delete']},
  body: {type: Object},
  isActive: {type: Boolean, default: true}
}, {timestamps: true})

module.exports = mongoose.model('Intercom', intercom)
