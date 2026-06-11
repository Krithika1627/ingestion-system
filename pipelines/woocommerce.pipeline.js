const logger = require('../services/logger.service');
const { runWooCategoryPipeline } = require('./category.pipeline');
const { runWooProductPipeline } = require('./product.pipeline');
const {
  updateStoreLastSynced,
  getCategoryBySourceId,
  getProductsByStoreAndSource,
  updateProductCategoryIds
} = require('../services/db.service');

async function enrichWooCommerceProductCategories(storeId) {
  const pipelineStoreId = storeId || 'store_woo_001';
  const startTime = Date.now();

  logger.info({
    message: 'WooCommerce category enrichment started',
    platform: 'woocommerce',
    storeId: pipelineStoreId
  });

  const products = await getProductsByStoreAndSource(pipelineStoreId, 'woocommerce');
  let processed = 0;
  let updated = 0;
  let missingCategories = 0;

  for (const product of products) {
    try {
      processed += 1;
      const productSourceId = product?.sourceId || null;
      const categoryIds = Array.isArray(product?.categoryIds) ? product.categoryIds : [];

      if (!productSourceId || categoryIds.length === 0) {
        continue;
      }

      const uniqueSourceIds = Array.from(
        new Set(categoryIds.map((id) => (id !== null && id !== undefined ? String(id) : null)).filter(Boolean))
      );

      const canonicalIds = [];
      for (const sourceCategoryId of uniqueSourceIds) {
        const category = await getCategoryBySourceId(
          sourceCategoryId,
          pipelineStoreId,
          'woocommerce'
        );

        if (!category?.id) {
          missingCategories += 1;
          logger.warn({
            message: 'Missing WooCommerce category mapping',
            sourceCategoryId,
            productSourceId
          });
          continue;
        }

        canonicalIds.push(category.id);
      }

      const uniqueCanonicalIds = Array.from(new Set(canonicalIds));
      const didUpdate = await updateProductCategoryIds(
        productSourceId,
        pipelineStoreId,
        uniqueCanonicalIds
      );
      if (didUpdate) {
        updated += 1;
      }
    } catch (error) {
      logger.error({
        message: 'WooCommerce category enrichment error',
        platform: 'woocommerce',
        storeId: pipelineStoreId,
        productSourceId: product?.sourceId || null,
        error: error?.message || String(error)
      });
    }
  }

  const duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
  logger.info({
    message: 'WooCommerce category enrichment complete',
    platform: 'woocommerce',
    storeId: pipelineStoreId,
    processed,
    updated,
    missingCategories,
    duration
  });

  return { processed, updated, missingCategories, duration };
}

async function runWooFullSync(storeId = 'store_woo_001', since) {
  const start = Date.now();
  const pipelineStoreId = storeId || 'store_woo_001';

  logger.info({
    message: 'WooCommerce full sync started',
    platform: 'woocommerce',
    storeId: pipelineStoreId
  });

  const categorySummary = await runWooCategoryPipeline(pipelineStoreId);
  const productSummary = await runWooProductPipeline(pipelineStoreId, since);
  const enrichmentSummary = await enrichWooCommerceProductCategories(pipelineStoreId);

  //await updateStoreLastSynced(pipelineStoreId);

  const duration = Number(((Date.now() - start) / 1000).toFixed(2));
  logger.info({
    message: 'WooCommerce full sync complete',
    platform: 'woocommerce',
    storeId: pipelineStoreId,
    duration,
    categorySummary,
    productSummary,
    enrichmentSummary
  });

  return { categorySummary, productSummary, enrichmentSummary };
}

module.exports = { runWooFullSync, enrichWooCommerceProductCategories };
