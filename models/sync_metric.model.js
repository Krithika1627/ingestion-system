const mongoose = require('mongoose');

const syncMetricSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true },
    platform: { type: String, required: true },
    syncType: {
      type: String,
      required: true,
      enum: ['full', 'incremental']
    },
    status: {
      type: String,
      required: true,
      enum: ['success', 'partial', 'failed']
    },
    totalProducts: { type: Number, default: 0 },
    successProducts: { type: Number, default: 0 },
    failedProducts: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    syncedAt: { type: Date, default: Date.now },
    isFullSync: { type: Boolean, default: false },
    errorMessage: { type: String, default: null }
  },
  { versionKey: false }
);

syncMetricSchema.index(
  { syncedAt: 1 },
  { expireAfterSeconds: 2592000 }
);

const SyncMetric =
  mongoose.models.SyncMetric ||
  mongoose.model('SyncMetric', syncMetricSchema);

module.exports = { SyncMetric };
