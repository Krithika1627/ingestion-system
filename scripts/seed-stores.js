/**
 * Seed the stores collection with default Shopify and Magento store records.
 */
require('dotenv').config();

const mongoose = require('mongoose');
const logger = require('../services/logger.service');

/**
 * Upsert the default store records.
 * @returns {Promise<void>}
 */
async function seedStores() {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    logger.error({ message: 'MONGO_URI is not configured', service: 'seed' });
    return;
  }

  const storeDocs = [
    {
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
    },
    {
      id: 'store_magento_001',
      name: 'BAE Magento Dev Store',
      platform: 'magento',
      domain: 'magento2-demo.magebit.com',
      isActive: true,
      syncFrequency: 'hourly',
      ingestionType: 'full',
      metaData: {
        currency: 'INR',
        country: 'IN',
        timezone: 'Asia/Kolkata'
      },
      syncConfig: {
        availabilityThreshold: 10,
        batchSize: 20,
        rateLimitDelay: 1000,
        retryAttempts: 3
      },
      createdAt: new Date().toISOString(),
      lastSyncedAt: null
    },
    {
      id: 'store_woo_001',
      name: 'BAE WooCommerce Dev Store',
      platform: 'woocommerce',
      domain: process.env.WOO_STORE_URL || '',
      isActive: true,
      syncFrequency: 'hourly',
      ingestionType: 'full',
      metaData: {
        currency: 'INR',
        country: 'IN',
        timezone: 'Asia/Kolkata'
      },
      syncConfig: {
        availabilityThreshold: 10,
        batchSize: 100,
        rateLimitDelay: 500,
        retryAttempts: 3
      },
      createdAt: new Date().toISOString(),
      lastSyncedAt: null
    },
    {
      id: 'store_unicommerce_001',
      name: 'BAE Unicommerce Inventory Store',
      platform: 'unicommerce',
      domain: process.env.UNICOMMERCE_BASE_URL || 'https://demo.unicommerce.com',
      isActive: true,
      syncFrequency: 'hourly',
      ingestionType: 'inventory_only',
      metaData: {
        currency: 'INR',
        country: 'IN',
        timezone: 'Asia/Kolkata',
        facilityCode: 'FACILITY_DELHI_01'
      },
      syncConfig: {
        availabilityThreshold: 10,
        batchSize: 50,
        rateLimitDelay: 500,
        retryAttempts: 3
      },
      createdAt: new Date().toISOString(),
      lastSyncedAt: null
    }
  ];

  try {
    await mongoose.connect(mongoUri);
    const collection = mongoose.connection.collection('stores');
    for (const storeDoc of storeDocs) {
      await collection.updateOne({ id: storeDoc.id }, { $set: storeDoc }, { upsert: true });
      logger.info({
        message: 'Store seed complete',
        service: 'seed',
        storeId: storeDoc.id
      });
    }
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

seedStores();
