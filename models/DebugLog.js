const mongoose = require('mongoose');

const debugLogSchema = new mongoose.Schema({
  accountName: { type: String, required: true },
  errorType: { type: String, default: 'ui-missing' },
  screenshotUrl: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  message: String
});

module.exports = mongoose.model('DebugLog', debugLogSchema);