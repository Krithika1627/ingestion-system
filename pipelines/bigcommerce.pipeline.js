/**
 * BigCommerce master sync pipeline.
 */
const logger = require('../services/logger.service');
const { runBigCommerceCategoryPipeline } = require('./category.pipeline');
const { runBigCommerceProductPipeline } = require('./product.pipeline');
const { updateStoreLastSynced } = require('../services/db.service');

/**
 * Run BigCommerce full sync (categories then products).
 * @param {string} storeId
 * @param {Date|null} [since] - Optional: only fetch products modified after this date
 * @returns {Promise<{categorySummary: object, productSummary: object}>}
 */
async function runBigCommerceFullSync(storeId = 'store_bigcommerce_001', since) {
  const start = Date.now();
  const pipelineStoreId = storeId || 'store_bigcommerce_001';

  logger.info({
    message: 'BigCommerce full sync started',
    platform: 'bigcommerce',
    storeId: pipelineStoreId
  });

  const categorySummary = await runBigCommerceCategoryPipeline(pipelineStoreId);
  const productSummary = await runBigCommerceProductPipeline(pipelineStoreId, since);

  await updateStoreLastSynced(pipelineStoreId);

  const duration = Number(((Date.now() - start) / 1000).toFixed(2));
  logger.info({
    message: 'BigCommerce full sync complete',
    platform: 'bigcommerce',
    storeId: pipelineStoreId,
    duration,
    categorySummary,
    productSummary
  });

  return { categorySummary, productSummary };
}

module.exports = { runBigCommerceFullSync };
