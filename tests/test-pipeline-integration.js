const { connectDB } = require('../services/db.service');
const { runScraperProductPipeline } = require('../services/scraper/scraper.pipeline');
const mongoose = require('mongoose');
require('dotenv').config();

async function runTests() {
  await connectDB();

  const db = mongoose.connection.db;

  console.log('\n=== Test 1: Re-ingest same products, no duplicates ===');

  // Get a few existing scraped products
  const existingProducts = await db
    .collection('products')
    .find({ source: 'scraped' })
    .limit(5)
    .toArray();

  if (existingProducts.length === 0) {
    console.log('No scraped products found. Skipping test.');
    return;
  }

  const before = await db.collection('canonical_products').countDocuments();

  await runScraperProductPipeline(
    existingProducts,
    'store_scraped_001'
  );

  const after = await db.collection('canonical_products').countDocuments();

  console.log({
    before,
    after,
    newCanonicalProducts: after - before,
    passed: after - before === 0
  });

  console.log('\n=== Test 2: Shopify products have canonical IDs ===');

  const shopifyProduct = await db.collection('products').findOne({
    source: 'shopify',
    canonicalProductId: { $exists: true, $ne: null }
  });

  console.log({
    found: !!shopifyProduct,
    canonicalProductId: shopifyProduct?.canonicalProductId || null,
    passed: !!shopifyProduct?.canonicalProductId
  });

  console.log('\n=== Test 3: Conflict resolution logs ===');
  console.log(
    'Re-run a product/scraper sync and check logs for conflict resolution messages.'
  );

  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});