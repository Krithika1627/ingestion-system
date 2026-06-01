const mongoose = require('mongoose');

const DEFAULT_CRON_BY_PLATFORM = {
  shopify: '0 */6 * * *',
  magento: '0 */8 * * *',
  woocommerce: '0 */6 * * *',
  bigcommerce: '0 */6 * * *',
  unicommerce: '0 */12 * * *',
  scraped: '0 2 * * *'
};

const syncConfigSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true },
    platform: {
      type: String,
      required: true,
      enum: ['shopify', 'magento', 'woocommerce', 'bigcommerce', 'unicommerce', 'scraped']
    },
    cronExpression: {
      type: String,
      required: true,
      default: function defaultCronExpression() {
        return DEFAULT_CRON_BY_PLATFORM[this.platform] || '0 */6 * * *';
      }
    },
    isActive: { type: Boolean, default: true },
    lastRunAt: { type: Date, default: null },
    nextRunAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

const SyncConfig = mongoose.models.SyncConfig || mongoose.model('SyncConfig', syncConfigSchema);

module.exports = { SyncConfig, DEFAULT_CRON_BY_PLATFORM };
