/**
 * Shopify category pipeline: fetch collections, transform, validate, and upsert.
 */
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const logger = require('../services/logger.service');
const { fetchCollections } = require('../connectors/shopify.connector');
const { transformCollection } = require('../transformers/shopify.transformer');
const { fetchCategories } = require('../connectors/magento.connector');
const { transformCategory } = require('../transformers/magento.transformer');
const { connectDB, upsertCategory } = require('../services/db.service');
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
function flattenCategoryTree(node, parentCanonicalId, storeId, result = []) {
  if (!node) {
    return result;
  }

  const level = typeof node?.level === 'number' ? node.level : null;

  if (level === 0) {
    for (const child of node?.children_data || []) {
      flattenCategoryTree(child, parentCanonicalId || null, storeId, result);
    }
    return result;
  }

  if (level === 1) {
    const canonicalRoot = transformCategory(node, parentCanonicalId || null, storeId);
    result.push(canonicalRoot);
    for (const child of node?.children_data || []) {
      flattenCategoryTree(child, canonicalRoot.id, storeId, result);
    }
    return result;
  }

  const canonical = transformCategory(node, parentCanonicalId, storeId);
  result.push(canonical);

  for (const child of node?.children_data || []) {
    flattenCategoryTree(child, canonical.id, storeId, result);
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

  const rawTree = await fetchCategories({ id: pipelineStoreId });
  const canonicalCategories = flattenCategoryTree(rawTree, null, pipelineStoreId, []);
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

module.exports = { runShopifyCategoryPipeline, runMagentoCategoryPipeline };
