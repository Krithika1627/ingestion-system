const logger = require('../services/logger.service');
const { runMagentoCategoryPipeline } = require('./category.pipeline');
const { runMagentoProductPipeline } = require('./product.pipeline');
const {
  updateStoreLastSynced,
  getCategoriesByStore,
  getRawResponsesByPlatform,
  addCategoryIdToProduct
} = require('../services/db.service');

async function enrichMagentoProductCategoryIds(storeId) {
  const pipelineStoreId = storeId || 'store_magento_001';
  logger.info({
    message: 'Magento categoryId enrichment started',
    platform: 'magento',
    storeId: pipelineStoreId
  });

  const categories = await getCategoriesByStore(pipelineStoreId, 'magento');
  if (categories.length === 0) {
    logger.warn({
      message: 'No categories found for Magento enrichment',
      platform: 'magento',
      storeId: pipelineStoreId
    });
    return;
  }

  const categoryMap = new Map(
    categories
      .filter((category) => category?.sourceId && category?.id)
      .map((category) => [String(category.sourceId), category.id])
  );

  const rawResponses = await getRawResponsesByPlatform('magento', pipelineStoreId);
  if (rawResponses.length === 0) {
    logger.warn({
      message: 'No Magento raw responses found for enrichment',
      platform: 'magento',
      storeId: pipelineStoreId
    });
    return;
  }

  let linksAdded = 0;
  let missingCategories = 0;
  let missingProducts = 0;

  for (const rawResponse of rawResponses) {
    const rawProduct = rawResponse?.data || {};
    const productSourceId =
      rawResponse?.sourceId !== undefined && rawResponse?.sourceId !== null
        ? String(rawResponse.sourceId)
        : rawProduct?.id !== undefined && rawProduct?.id !== null
          ? String(rawProduct.id)
          : null;

    if (!productSourceId) {
      continue;
    }

    const links = rawProduct?.extension_attributes?.category_links || [];
    if (!Array.isArray(links) || links.length === 0) {
      continue;
    }

    for (const link of links) {
      const categorySourceId =
        link?.category_id !== undefined && link?.category_id !== null
          ? String(link.category_id)
          : null;
      if (!categorySourceId) {
        continue;
      }

      const categoryId = categoryMap.get(categorySourceId);
      if (!categoryId) {
        missingCategories += 1;
        logger.warn({
          message: 'Magento category not found for product link',
          platform: 'magento',
          storeId: pipelineStoreId,
          productSourceId,
          categorySourceId
        });
        continue;
      }

      const updated = await addCategoryIdToProduct(
        productSourceId,
        categoryId,
        pipelineStoreId
      );
      if (updated) {
        linksAdded += 1;
      } else {
        missingProducts += 1;
      }
    }
  }

  logger.info({
    message: 'Magento categoryId enrichment complete',
    platform: 'magento',
    storeId: pipelineStoreId,
    categories: categories.length,
    linksAdded,
    missingCategories,
    missingProducts
  });
}

async function runMagentoFullSync(storeId = 'store_magento_001', since) {
  const start = Date.now();
  const pipelineStoreId = storeId || 'store_magento_001';

  logger.info({
    message: 'Magento full sync started',
    platform: 'magento',
    storeId: pipelineStoreId
  });

  const categorySummary = await runMagentoCategoryPipeline(pipelineStoreId);
  const productSummary = await runMagentoProductPipeline(pipelineStoreId, since);

  await enrichMagentoProductCategoryIds(pipelineStoreId);

  // await updateStoreLastSynced(pipelineStoreId);

  const duration = Number(((Date.now() - start) / 1000).toFixed(2));
  logger.info({
    message: 'Magento full sync complete',
    platform: 'magento',
    storeId: pipelineStoreId,
    duration,
    categorySummary,
    productSummary
  });

  return { categorySummary, productSummary };
}

module.exports = { runMagentoFullSync, enrichMagentoProductCategoryIds };
