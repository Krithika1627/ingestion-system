const mongoose = require('mongoose');

const failedJobSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true },
    platform: { type: String, required: true },
    cronExpression: { type: String, default: null },
    attemptNumber: { type: Number, required: true },
    totalAttempts: { type: Number, default: 3 },
    error: { type: String, default: null },
    errorStack: { type: String, default: null },
    syncWindow: {
      type: Object,
      default: { isFullSync: false, since: null }
    },
    failedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['pending_review', 'resolved'],
      default: 'pending_review'
    },
    resolvedAt: { type: Date, default: null }
  },
  { versionKey: false }
);

const FailedJob = mongoose.models.FailedJob || mongoose.model('FailedJob', failedJobSchema);

module.exports = { FailedJob };
