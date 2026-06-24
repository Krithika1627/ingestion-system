const mongoose = require('mongoose');

const dataQualityIssueSchema = new mongoose.Schema(
  {
    canonicalProductId: { type: String, required: true },
    issueCode: { type: String, required: true },
    issueDescription: { type: String, required: true },
    severity: {
      type: String,
      required: true,
      enum: ['warning', 'critical']
    },
    affectedField: { type: String, default: null },
    affectedValue: { type: mongoose.Schema.Types.Mixed, default: null },
    detectedAt: { type: Date, default: Date.now },
    resolved: { type: Boolean, default: false },
    resolvedAt: { type: Date, default: null },
    source: { type: String, default: null },
    storeId: { type: String, default: null }
  },
  { versionKey: false }
);

dataQualityIssueSchema.index({ canonicalProductId: 1 });
dataQualityIssueSchema.index({ resolved: 1 });
dataQualityIssueSchema.index({ severity: 1 });
dataQualityIssueSchema.index({ detectedAt: -1 });
dataQualityIssueSchema.index({ canonicalProductId: 1, issueCode: 1 });

const DataQualityIssue =
  mongoose.models.DataQualityIssue ||
  mongoose.model('DataQualityIssue', dataQualityIssueSchema);

module.exports = { DataQualityIssue };
