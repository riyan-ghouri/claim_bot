const mongoose = require('mongoose');

const accountSessionSchema = new mongoose.Schema({
  index: {
    type: Number,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  sessionData: {
    type: String,           // We store the whole JSON as string (same as before)
    required: true
  },
  lastClaimed: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['active', 'error', 'disabled'],
    default: 'active'
  },
  lastError: String,
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

module.exports = mongoose.model('AccountSession', accountSessionSchema);