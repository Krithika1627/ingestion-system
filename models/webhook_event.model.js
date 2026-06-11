const mongoose = require('mongoose');

const webhookEventSchema = new mongoose.Schema(
  {
    webhookId: { type: String, required: true, unique: true },
    platform: { type: String, required: true, enum: ['shopify', 'woocommerce'] },
    topic: { type: String, default: null },
    storeId: { type: String, default: null },
    receivedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

/* TTL index — documents auto-delete 24 hours after createdAt */
webhookEventSchema.index({ createdAt: 1 }, { expires: '24h' });
webhookEventSchema.index({ webhookId: 1, platform: 1 });

const WebhookEvent = mongoose.models.WebhookEvent || mongoose.model('WebhookEvent', webhookEventSchema);

module.exports = { WebhookEvent };
