const mongoose = require('mongoose');
require('dotenv').config();
const { connectDB, getCollection } = require('../services/db.service');
const logger = require('../services/logger.service');

async function setupIndexes() {
  await connectDB();

  logger.info({ message: 'Setting up indexes...', service: 'setup-indexes' });

  await getCollection('products').createIndexes([
    { key: { storeId: 1 }, name: 'products_storeId' },
    { key: { sourceId: 1, storeId: 1 }, unique: true, name: 'products_sourceId_storeId' },
    {
      key: { sku: 1, storeId: 1 },
      unique: true,
      name: 'products_sku_storeId_unique',
      partialFilterExpression: { sku: { $type: 'string', $gt: '' } }
    },
    {
      key: { groupingKey: 1, storeId: 1 },
      unique: true,
      name: 'products_groupingKey_storeId_unique',
      partialFilterExpression: { groupingKey: { $type: 'string', $gt: '' } }
    },
    { key: { status: 1 }, name: 'products_status' },
    { key: { categoryIds: 1 }, name: 'products_categoryIds' },
    { key: { source: 1, storeId: 1 }, name: 'products_source_storeId' },
  ]);
  logger.info({ message: 'Products indexes done', service: 'setup-indexes' });

  await getCollection('categories').createIndexes([
    { key: { storeId: 1 }, name: 'categories_storeId' },
    { key: { sourceId: 1, storeId: 1 }, unique: true, name: 'categories_sourceId_storeId' },
    { key: { slug: 1, storeId: 1 }, name: 'categories_slug_storeId' },
  ]);
  logger.info({ message: 'Categories indexes done', service: 'setup-indexes' });

  await getCollection('offers').createIndexes([
    { key: { storeId: 1 }, name: 'offers_storeId' },
    { key: { variantId: 1, storeId: 1 }, unique: true, name: 'offers_variantId_storeId' },
    { key: { productId: 1 }, name: 'offers_productId' },
    { key: { availability: 1 }, name: 'offers_availability' },
    { key: { canonicalProductId: 1 }, name: 'offers_canonicalProductId', background: true },
    {
      key: { canonicalProductId: 1, storeId: 1 },
      name: 'offers_canonicalProductId_storeId',
      background: true
    },
  ]);
  logger.info({ message: 'Offers indexes done', service: 'setup-indexes' });

  await getCollection('stores').createIndexes([
    { key: { id: 1 }, unique: true, name: 'stores_id' },
    { key: { platform: 1 }, name: 'stores_platform' },
    { key: { lastSyncedAt: -1 }, name: 'stores_lastSyncedAt', background: true },
    { key: { lastSyncStatus: 1 }, name: 'stores_lastSyncStatus', background: true },
  ]);
  logger.info({ message: 'Stores indexes done', service: 'setup-indexes' });

  await getCollection('raw_responses').createIndexes([
    { key: { storeId: 1, platform: 1 }, name: 'raw_storeId_platform' },
    { key: { sourceId: 1, storeId: 1 }, name: 'raw_sourceId_storeId' },
  ]);
  logger.info({ message: 'Raw responses indexes done', service: 'setup-indexes' });

  await getCollection('canonical_products').createIndexes([
    { key: { brand: 1 }, name: 'canonical_brand', background: true },
    { key: { category: 1 }, name: 'canonical_category', background: true },
    { key: { updatedAt: -1 }, name: 'canonical_updatedAt', background: true },
    { key: { 'sources.storeId': 1 }, name: 'canonical_sources_storeId', background: true },
    { key: { 'sources.source': 1 }, name: 'canonical_sources_source', background: true },
    { key: { 'priceRange.min': 1 }, name: 'canonical_priceRange_min', background: true },
    { key: { 'priceRange.max': -1 }, name: 'canonical_priceRange_max', background: true },
  ]);
  logger.info({ message: 'Canonical products indexes done', service: 'setup-indexes' });

  await getCollection('dataqualityissues').createIndexes([
    { key: { canonicalProductId: 1 }, name: 'dqi_canonicalProductId', background: true },
    { key: { severity: 1, resolved: 1 }, name: 'dqi_severity_resolved', background: true },
    { key: { detectedAt: -1 }, name: 'dqi_detectedAt', background: true },
  ]);
  logger.info({ message: 'Data quality issues indexes done', service: 'setup-indexes' });

  logger.info({ message: 'All indexes setup complete', service: 'setup-indexes' });
}

if (require.main === module) {
  setupIndexes()
    .then(() => {
      console.log('\nAll indexes created');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Index setup failed:', err);
      process.exit(1);
    });
}

module.exports = { setupIndexes };
