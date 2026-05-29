const mongoose = require('mongoose');
require('dotenv').config();
const { connectDB } = require('../services/db.service');

async function setupIndexes() {
  await connectDB();
  const db = mongoose.connection.db;

  console.log('Setting up indexes...');

  // Products
  await db.collection('products').createIndexes([
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
  console.log('Products indexes done');

  // Categories
  await db.collection('categories').createIndexes([
    { key: { storeId: 1 }, name: 'categories_storeId' },
    { key: { sourceId: 1, storeId: 1 }, unique: true, name: 'categories_sourceId_storeId' },
    { key: { slug: 1, storeId: 1 }, name: 'categories_slug_storeId' },
  ]);
  console.log('Categories indexes done');

  // Offers
  await db.collection('offers').createIndexes([
    { key: { storeId: 1 }, name: 'offers_storeId' },
    { key: { variantId: 1, storeId: 1 }, unique: true, name: 'offers_variantId_storeId' },
    { key: { productId: 1 }, name: 'offers_productId' },
    { key: { availability: 1 }, name: 'offers_availability' },
  ]);
  console.log('Offers indexes done');

  // Stores
  await db.collection('stores').createIndexes([
    { key: { id: 1 }, unique: true, name: 'stores_id' },
    { key: { platform: 1 }, name: 'stores_platform' },
  ]);
  console.log('Stores indexes done');

  // Raw responses
  await db.collection('raw_responses').createIndexes([
    { key: { storeId: 1, platform: 1 }, name: 'raw_storeId_platform' },
    { key: { sourceId: 1, storeId: 1 }, name: 'raw_sourceId_storeId' },
  ]);
  console.log('Raw responses indexes done');

  console.log('\nAll indexes created');
  process.exit(0);
}

setupIndexes().catch(err => {
  console.error('Index setup failed:', err);
  process.exit(1);
});