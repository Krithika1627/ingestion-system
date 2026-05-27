require('dotenv').config();

const mongoose = require('mongoose');
const logger = require('../services/logger.service');
const { connectDB } = require('../services/db.service');
const {
  backfillOfferCanonicalIds,
  aggregateOffers,
  getOfferSummary,
  runFullOfferAggregation
} = require('../services/offer-aggregation/offer.aggregation.service');

async function run() {
  await connectDB();

  const dryRunSummary = await backfillOfferCanonicalIds({ dryRun: true });
  logger.info({ step: 'backfill dry run', summary: dryRunSummary });

  const liveSummary = await backfillOfferCanonicalIds({ dryRun: false });
  logger.info({ step: 'backfill live run', summary: liveSummary });

  const offersCollection = mongoose.connection.collection('offers');
  const productsCollection = mongoose.connection.collection('products');
  const canonicalCollection = mongoose.connection.collection('canonical_products');

  const offerSample = await offersCollection.findOne(
    { canonicalProductId: { $exists: true, $ne: null } },
    { projection: { canonicalProductId: 1 } }
  );

  if (!offerSample?.canonicalProductId) {
    logger.warn({ step: 'sample lookup', message: 'No offers with canonicalProductId found' });
    await mongoose.disconnect();
    process.exit(0);
  }

  const canonicalProductId = offerSample.canonicalProductId;

  const product = await productsCollection.findOne(
    { canonicalProductId },
    { projection: { id: 1, title: 1, storeId: 1 } }
  );

  logger.info({
    step: 'sample canonical product',
    canonicalProductId,
    productId: product?.id || null,
    title: product?.title || null,
    storeId: product?.storeId || null
  });

  const aggregated = await aggregateOffers(canonicalProductId);
  logger.info({
    step: 'aggregate offers',
    canonicalProductId,
    totalOffers: aggregated?.totalOffers || 0,
    offers: aggregated?.offers || []
  });

  const summary = await getOfferSummary(canonicalProductId);
  logger.info({
    step: 'offer summary',
    canonicalProductId,
    lowestPrice: summary?.lowestPrice ?? null,
    highestPrice: summary?.highestPrice ?? null,
    availableAt: summary?.availableAt || [],
    totalOffers: summary?.totalOffers || 0
  });

  const fullSummary = await runFullOfferAggregation({ syncPriceRanges: true });
  logger.info({ step: 'full offer aggregation', summary: fullSummary });

  const canonicalDoc = await canonicalCollection.findOne({ canonicalId: canonicalProductId });
  logger.info({
    step: 'canonical price range',
    canonicalProductId,
    priceRange: canonicalDoc?.priceRange || null
  });

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((error) => {
  logger.error({
    step: 'offer aggregation test failed',
    error: error?.message || String(error)
  });
  mongoose.disconnect().finally(() => process.exit(1));
});
