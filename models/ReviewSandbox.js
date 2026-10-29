const mongoose = require('mongoose');
// Reviewer activity is isolated from production orders, payments, inventory and seller settlements.
const schema = new mongoose.Schema({
  _id: { type: String, default: 'play-review-v1' },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true, optimisticConcurrency: true });
module.exports = mongoose.model('ReviewSandbox', schema);
