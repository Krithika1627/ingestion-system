/**
 * Shopify category pipeline: fetch collections, transform, validate, and upsert.
 */
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const logger = require('../services/logger.service');
const { fetchCollections } = require('../connectors/shopify.connector');
const { transformCollection } = require('../transformers/shopify.transformer');
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

module.exports = { runShopifyCategoryPipeline };
