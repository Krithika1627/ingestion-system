const mongoose = require('mongoose');

const apiMetricSchema = new mongoose.Schema(
  {
    endpoint: { type: String, required: true },
    hour: { type: Date, required: true },
    requestCount: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    totalResponseTimeMs: { type: Number, default: 0 },
    avgResponseTimeMs: { type: Number, default: 0 }
  },
  { versionKey: false }
);

apiMetricSchema.index({ endpoint: 1, hour: 1 }, { unique: true });
apiMetricSchema.index(
  { hour: 1 },
  { expireAfterSeconds: 604800 }
);

const ApiMetric =
  mongoose.models.ApiMetric ||
  mongoose.model('ApiMetric', apiMetricSchema);

module.exports = { ApiMetric };
