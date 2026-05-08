/**
 * Seed the stores collection with the default Shopify store record.
 */
require('dotenv').config();

const mongoose = require('mongoose');
const logger = require('../services/logger.service');

/**
 * Upsert the default Shopify store record.
 * @returns {Promise<void>}
 */
async function seedStore() {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    logger.error({ message: 'MONGO_URI is not configured', service: 'seed' });
    return;
  }

  const storeDoc = {
    id: 'store_shopify_001',
    name: 'BAE Shopify Dev Store',
    platform: 'shopify',
    domain: 'baefs1.myshopify.com',
    isActive: true,
    syncFrequency: 'realtime',
    ingestionType: 'full',
    metaData: {
      currency: 'USD',
      country: 'IN',
      timezone: 'Asia/Kolkata'
    },
    syncConfig: {
      availabilityThreshold: 10,
      batchSize: 50,
      rateLimitDelay: 500,
      retryAttempts: 3
    },
    createdAt: new Date().toISOString(),
    lastSyncedAt: null
  };

  try {
    await mongoose.connect(mongoUri);
    const collection = mongoose.connection.collection('stores');
    await collection.updateOne({ id: storeDoc.id }, { $set: storeDoc }, { upsert: true });
    logger.info({
      message: 'Store seed complete',
      service: 'seed',
      storeId: storeDoc.id
    });
  } catch (error) {
    logger.error({
      message: 'Store seed failed',
      service: 'seed',
      error: error?.message || String(error)
    });
  } finally {
    await mongoose.disconnect();
  }
}

seedStore();
