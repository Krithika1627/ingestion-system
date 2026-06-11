const logger = require('../services/logger.service');
const { runShopifyCategoryPipeline } = require('./category.pipeline');
const { runShopifyProductPipeline } = require('./product.pipeline');
const { fetchCollectionProducts } = require('../connectors/shopify.connector');
const {
  getCategoriesByStore,
  addCategoryIdToProduct,
  updateStoreLastSynced
} = require('../services/db.service');

async function enrichProductCategoryIds(storeId) {
  const pipelineStoreId = storeId || 'store_shopify_001';

  logger.info({
    message: 'Shopify categoryId enrichment started',
    platform: 'shopify',
    storeId: pipelineStoreId
  });

  const categories = await getCategoriesByStore(pipelineStoreId);
  if (categories.length === 0) {
    logger.warn({
      message: 'No categories found for categoryId enrichment',
      platform: 'shopify',
      storeId: pipelineStoreId
    });
    return;
  }

  let linkCount = 0;

  for (const category of categories) {
    const collectionId = category?.sourceId;
    if (!collectionId) {
      logger.warn({
        message: 'Skipping category with missing sourceId',
        platform: 'shopify',
        storeId: pipelineStoreId,
        categoryId: category?.id || null
      });
      continue;
    }

    const productIds = await fetchCollectionProducts(pipelineStoreId, collectionId);
    const uniqueProductIds = Array.from(new Set(productIds));

    for (const productSourceId of uniqueProductIds) {
      const updated = await addCategoryIdToProduct(
        productSourceId,
        category?.id || null,
        pipelineStoreId
      );
      if (updated) {
        linkCount += 1;
      }
    }
  }

  logger.info({
    message: 'Shopify categoryId enrichment complete',
    platform: 'shopify',
    storeId: pipelineStoreId,
    categories: categories.length,
    linksAdded: linkCount
  });
}

async function runShopifyFullSync(storeId, since) {
  const pipelineStoreId = storeId || 'store_shopify_001';
  const startTime = Date.now();

  logger.info({
    message: 'Shopify full sync started',
    platform: 'shopify',
    storeId: pipelineStoreId
  });

  const categorySummary = await runShopifyCategoryPipeline(pipelineStoreId);
  const productSummary = await runShopifyProductPipeline(pipelineStoreId, since);

  await enrichProductCategoryIds(pipelineStoreId);

  const duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
  logger.info({
    message: 'Shopify full sync complete',
    platform: 'shopify',
    storeId: pipelineStoreId,
    duration
  });

  return { categorySummary, productSummary };
}

module.exports = { runShopifyFullSync, enrichProductCategoryIds };
