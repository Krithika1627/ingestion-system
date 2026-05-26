require('dotenv').config();

const mongoose = require('mongoose');
const logger = require('../services/logger.service');
const { connectDB } = require('../services/db.service');
const {
  generateCanonicalId,
  getOrCreateCanonical,
  backfillCanonicalIds,
  getCanonicalWithSources
} = require('../services/canonical/canonical.service');

function buildProduct(title, brand, category, price) {
  return {
    title,
    cleanedTitle: title,
    brand: brand || null,
    normalizedBrand: brand ? brand.toLowerCase().trim() : null,
    category: category || null,
    source: 'scraped',
    storeId: 'store_test',
    sourceId: `https://example.com/${encodeURIComponent(title || 'unknown')}`,
    variants: [
      {
        price: Number.isFinite(price) ? price : null,
        currency: 'INR'
      }
    ]
  };
}

async function run() {
  await connectDB();

  const productA = buildProduct('Apple iPhone 13', 'Apple', 'Phones', 55999);
  const productB = buildProduct('Apple iPhone 13', 'Apple', 'Phones', 55999);
  const productC = buildProduct('Samsung Galaxy S22', 'Samsung', 'Phones', 65000);
  const productNoTitle = buildProduct('', 'Apple', 'Phones', 1000);

  const idA = generateCanonicalId(productA);
  const idB = generateCanonicalId(productB);
  const idC = generateCanonicalId(productC);
  const idNoTitle = generateCanonicalId(productNoTitle);

  logger.info({ step: 'ID generation', idA, idB, idC, idNoTitle });

  const first = await getOrCreateCanonical(productA);
  const second = await getOrCreateCanonical(productA);
  logger.info({
    step: 'getOrCreateCanonical',
    createdFirst: first?.created === true,
    createdSecond: second?.created === true,
    canonicalId: first?.canonical?.canonicalId || null
  });

  const canonicalCount = await mongoose.connection
    .collection('canonical_products')
    .countDocuments({ canonicalId: first?.canonical?.canonicalId || null });
  logger.info({ step: 'canonical count', count: canonicalCount });

  const dryRunSummary = await backfillCanonicalIds({ dryRun: true, batchSize: 25 });
  logger.info({ step: 'backfill dry run', summary: dryRunSummary });

  const liveSummary = await backfillCanonicalIds({ dryRun: false, batchSize: 25 });
  logger.info({ step: 'backfill live', summary: liveSummary });

  if (first?.canonical?.canonicalId) {
    const resolved = await getCanonicalWithSources(first.canonical.canonicalId);
    logger.info({
      step: 'getCanonicalWithSources',
      canonicalId: first.canonical.canonicalId,
      sources: resolved?.sources?.length || 0,
      offers: resolved?.offers?.length || 0
    });
  }

  process.exit(0);
}

run();
