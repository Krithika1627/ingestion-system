/**
 * Shopify category pipeline: fetch collections, transform, validate, and upsert.
 */
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const logger = require('../services/logger.service');
const { fetchCollections } = require('../connectors/shopify.connector');
const { transformCollection } = require('../transformers/shopify.transformer');
const { fetchCategories: fetchMagentoCategories } = require('../connectors/magento.connector');
const { transformCategory: transformMagentoCategory } = require('../transformers/magento.transformer');
const { fetchCategories: fetchWooCategories } = require('../connectors/woocommerce.connector');
const { transformCategory: transformWooCategory } = require('../transformers/woocommerce.transformer');
const { fetchCategories: fetchBigCommerceCategories } = require('../connectors/bigcommerce.connector');
const { transformCategory: transformBigCommerceCategory } = require('../transformers/bigcommerce.transformer');
const { connectDB, upsertCategory, getStoreById } = require('../services/db.service');
const categorySchema = require('../schemas/category.schema.json');

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validate = ajv.compile(categorySchema);

/**
 * Run Shopify category ingestion pipeline.
 * @param {string} storeId
 * @returns {Promise<{total:number, success:number, failed:number, duration:number}>}
 */
async function runShopifyCategoryPipeline(storeId) {
  const pipelineStoreId = storeId || 'store_shopify_001';
  const startTime = Date.now();

  logger.info({
    message: 'Shopify category pipeline started',
    platform: 'shopify',
    storeId: pipelineStoreId
  });

  await connectDB();

  const rawCollections = await fetchCollections(pipelineStoreId);
  const summary = {
    total: rawCollections.length,
    success: 0,
    failed: 0,
    duration: 0
  };

  for (const rawCollection of rawCollections) {
    try {
      const canonicalCategory = transformCollection(rawCollection, pipelineStoreId);
      const isValid = validate(canonicalCategory);

      if (!isValid) {
        summary.failed += 1;
        logger.warn({
          message: 'Shopify category validation failed',
          platform: 'shopify',
          storeId: pipelineStoreId,
          sourceId: canonicalCategory?.sourceId || null,
          errors: validate.errors
        });
        continue;
      }

      await upsertCategory(canonicalCategory);
      summary.success += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error({
        message: 'Shopify category pipeline error',
        platform: 'shopify',
        storeId: pipelineStoreId,
        sourceId: rawCollection?.id || null,
        error: error?.message || String(error)
      });
    }
  }

  summary.duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
  logger.info({
    message: 'Shopify category pipeline complete',
    platform: 'shopify',
    storeId: pipelineStoreId,
    total: summary.total,
    success: summary.success,
    failed: summary.failed,
    duration: summary.duration
  });

  return summary;
}

/**
 * Recursively flatten Magento category tree into canonical categories.
 * @param {object} node
 * @param {string|null} parentCanonicalId
 * @param {string} storeId
 * @param {object[]} result
 * @returns {object[]}
 */
function flattenCategoryTree(node, parentCanonicalId, store, result = []){

  if (!node) {
    return result;
  }

  const level = typeof node?.level === 'number' ? node.level : null;

  if (level === 0) {
    for (const child of node?.children_data || []) {
      flattenCategoryTree(child, parentCanonicalId || null, store, result);;
    }
    return result;
  }
  

  if (level === 1) {
    const canonicalRoot = transformMagentoCategory(node, parentCanonicalId, store);
    result.push(canonicalRoot);
    for (const child of node?.children_data || []) {
      flattenCategoryTree(child, canonicalRoot.id, store, result);
    }
    return result;
  }

  const canonical = transformMagentoCategory(node, parentCanonicalId, store);
  result.push(canonical);

  for (const child of node?.children_data || []) {
    flattenCategoryTree(child, canonical.id, store, result);
  }

  return result;
}

/**
 * Run Magento category ingestion pipeline.
 * @param {string} storeId
 * @returns {Promise<{total:number, success:number, failed:number, duration:number}>}
 */
async function runMagentoCategoryPipeline(storeId) {
  const pipelineStoreId = storeId || 'store_magento_001';
  const startTime = Date.now();

  logger.info({
    message: 'Magento category pipeline started',
    platform: 'magento',
    storeId: pipelineStoreId
  });

  await connectDB();

  const { getStoreById } = require('../services/db.service');

  const storeRecord = await getStoreById(pipelineStoreId);

  const rawTree = await fetchMagentoCategories({ id: pipelineStoreId });
  const canonicalCategories = flattenCategoryTree(rawTree, null, storeRecord, []);
  const summary = {
    total: canonicalCategories.length,
    success: 0,
    failed: 0,
    duration: 0
  };

  for (const canonicalCategory of canonicalCategories) {
    try {
      const isValid = validate(canonicalCategory);

      if (!isValid) {
        summary.failed += 1;
        logger.warn({
          message: 'Magento category validation failed',
          platform: 'magento',
          storeId: pipelineStoreId,
          sourceId: canonicalCategory?.sourceId || null,
          errors: validate.errors
        });
        continue;
      }

      await upsertCategory(canonicalCategory);
      summary.success += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error({
        message: 'Magento category pipeline error',
        platform: 'magento',
        storeId: pipelineStoreId,
        sourceId: canonicalCategory?.sourceId || null,
        error: error?.message || String(error)
      });
    }
  }

  summary.duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
  logger.info({
    message: 'Magento category pipeline complete',
    platform: 'magento',
    storeId: pipelineStoreId,
    total: summary.total,
    success: summary.success,
    failed: summary.failed,
    duration: summary.duration
  });

  return summary;
}

/**
 * Run WooCommerce category ingestion pipeline.
 * @param {string} storeId
 * @returns {Promise<{total:number, success:number, failed:number, duration:number}>}
 */
async function runWooCategoryPipeline(storeId) {
  const pipelineStoreId = storeId || 'store_woo_001';
  const startTime = Date.now();

  logger.info({
    message: 'WooCommerce category pipeline started',
    platform: 'woocommerce',
    storeId: pipelineStoreId
  });

  await connectDB();

  const rawCategories = await fetchWooCategories({ id: pipelineStoreId });
  const canonicalWithParent = rawCategories.map((node) =>
    transformWooCategory(node, pipelineStoreId)
  );

  const idMap = new Map(
    canonicalWithParent
      .filter((category) => category?.sourceId && category?.id)
      .map((category) => [category.sourceId, category.id])
  );

  const resolvedCategories = canonicalWithParent.map((category) => {
    const parentId = category?.parentSourceId ? idMap.get(category.parentSourceId) || null : null;
    const resolved = { ...category, parentId };
    delete resolved.parentSourceId;
    return resolved;
  });

  const summary = {
    total: resolvedCategories.length,
    success: 0,
    failed: 0,
    duration: 0
  };

  for (const canonicalCategory of resolvedCategories) {
    try {
      const isValid = validate(canonicalCategory);

      if (!isValid) {
        summary.failed += 1;
        logger.warn({
          message: 'WooCommerce category validation failed',
          platform: 'woocommerce',
          storeId: pipelineStoreId,
          sourceId: canonicalCategory?.sourceId || null,
          errors: validate.errors
        });
        continue;
      }

      await upsertCategory(canonicalCategory);
      summary.success += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error({
        message: 'WooCommerce category pipeline error',
        platform: 'woocommerce',
        storeId: pipelineStoreId,
        sourceId: canonicalCategory?.sourceId || null,
        error: error?.message || String(error)
      });
    }
  }

  summary.duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
  logger.info({
    message: 'WooCommerce category pipeline complete',
    platform: 'woocommerce',
    storeId: pipelineStoreId,
    total: summary.total,
    success: summary.success,
    failed: summary.failed,
    duration: summary.duration
  });

  return summary;
}

/**
 * Run BigCommerce category ingestion pipeline.
 * @param {string} storeId
 * @returns {Promise<{total:number, success:number, failed:number, duration:number}>}
 */
async function runBigCommerceCategoryPipeline(storeId) {
  const pipelineStoreId = storeId || 'store_bigcommerce_001';
  const startTime = Date.now();

  logger.info({
    message: 'BigCommerce category pipeline started',
    platform: 'bigcommerce',
    storeId: pipelineStoreId
  });

  await connectDB();

  const storeRecord = await getStoreById(pipelineStoreId);
  const rawCategories = await fetchBigCommerceCategories({
    id: pipelineStoreId,
    metaData: storeRecord?.metaData || {},
    syncConfig: storeRecord?.syncConfig || {}
  });

  const canonicalWithParent = rawCategories.map((node) =>
    transformBigCommerceCategory(node, pipelineStoreId)
  );

  const idMap = new Map(
    canonicalWithParent
      .filter((category) => category?.sourceId && category?.id)
      .map((category) => [category.sourceId, category.id])
  );

  const resolvedCategories = canonicalWithParent.map((category) => {
    const parentId = category?.parentSourceId ? idMap.get(category.parentSourceId) || null : null;
    const resolved = { ...category, parentId };
    delete resolved.parentSourceId;
    return resolved;
  });

  const categoryById = new Map(
    resolvedCategories
      .filter((category) => category?.id)
      .map((category) => [category.id, category])
  );

  let updated = true;
  let iterations = 0;
  while (updated && iterations < resolvedCategories.length) {
    updated = false;
    for (const category of resolvedCategories) {
      if (typeof category.level === 'number') {
        continue;
      }
      if (!category.parentId) {
        category.level = 0;
        updated = true;
        continue;
      }
      const parent = categoryById.get(category.parentId);
      if (parent && typeof parent.level === 'number') {
        category.level = parent.level + 1;
        updated = true;
      }
    }
    iterations += 1;
  }

  const summary = {
    total: resolvedCategories.length,
    success: 0,
    failed: 0,
    duration: 0
  };

  for (const canonicalCategory of resolvedCategories) {
    try {
      const isValid = validate(canonicalCategory);

      if (!isValid) {
        summary.failed += 1;
        logger.warn({
          message: 'BigCommerce category validation failed',
          platform: 'bigcommerce',
          storeId: pipelineStoreId,
          sourceId: canonicalCategory?.sourceId || null,
          errors: validate.errors
        });
        continue;
      }

      await upsertCategory(canonicalCategory);
      summary.success += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error({
        message: 'BigCommerce category pipeline error',
        platform: 'bigcommerce',
        storeId: pipelineStoreId,
        sourceId: canonicalCategory?.sourceId || null,
        error: error?.message || String(error)
      });
    }
  }

  summary.duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
  logger.info({
    message: 'BigCommerce category pipeline complete',
    platform: 'bigcommerce',
    storeId: pipelineStoreId,
    total: summary.total,
    success: summary.success,
    failed: summary.failed,
    duration: summary.duration
  });

  return summary;
}

module.exports = {
  runShopifyCategoryPipeline,
  runMagentoCategoryPipeline,
  runWooCategoryPipeline,
  runBigCommerceCategoryPipeline
};
