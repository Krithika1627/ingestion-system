/**
 * Shopify product pipeline: fetch raw data, transform, validate, and upsert.
 */
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const logger = require('../services/logger.service');
const { fetchProducts } = require('../connectors/shopify.connector');
const { transformProduct } = require('../transformers/shopify.transformer');
const {
  connectDB,
  upsertProduct,
  upsertRaw,
  upsertOffer
} = require('../services/db.service');
const productSchema = require('../schemas/product.schema.json');

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validate = ajv.compile(productSchema);

function buildOfferFromProduct(product) {
  const primaryVariant = product?.variants?.[0] || null;

  return {
    sourceId: product?.sourceId || null,
    storeId: product?.storeId || null,
    sku: product?.sku || null,
    title: product?.title || null,
    price: primaryVariant?.price ?? null,
    compareAtPrice: primaryVariant?.compareAtPrice ?? null,
    currency: primaryVariant?.currency ?? null,
    inventoryQty: primaryVariant?.inventoryQty ?? null,
    isInStock: primaryVariant?.isInStock ?? false,
    lastSyncedAt: product?.lastSyncedAt || new Date().toISOString()
  };
}

/**
 * Run Shopify product ingestion pipeline.
 * @param {string} storeId
 * @returns {Promise<{total:number, success:number, failed:number, duration:number}>}
 */
async function runShopifyProductPipeline(storeId) {
  const pipelineStoreId = storeId || 'store_shopify_001';
  const startTime = Date.now();

  await connectDB();

  const rawProducts = await fetchProducts(pipelineStoreId);
  const summary = {
    total: rawProducts.length,
    success: 0,
    failed: 0,
    duration: 0
  };

  for (const rawProduct of rawProducts) {
    try {
      const rawPayload = {
        storeId: pipelineStoreId,
        sourceId: rawProduct?.id || null,
        data: rawProduct
      };

      await upsertRaw('shopify', rawPayload);

      const canonicalProduct = transformProduct(rawProduct, pipelineStoreId);
      const isValid = validate(canonicalProduct);

      if (!isValid) {
        summary.failed += 1;
        logger.warn({
          message: 'Shopify product validation failed',
          platform: 'shopify',
          storeId: pipelineStoreId,
          sourceId: canonicalProduct?.sourceId || null,
          errors: validate.errors
        });
        continue;
      }

      await upsertProduct(canonicalProduct);
      logger.info({
        message: 'Shopify product upserted',
        platform: 'shopify',
        storeId: pipelineStoreId,
        sourceId: canonicalProduct?.sourceId || null
      });

      const offerRecord = buildOfferFromProduct(canonicalProduct);
      if (offerRecord?.sourceId && offerRecord?.storeId) {
        await upsertOffer(offerRecord);
        logger.info({
          message: 'Shopify offer upserted',
          platform: 'shopify',
          storeId: pipelineStoreId,
          sourceId: offerRecord?.sourceId || null
        });
      } else {
        logger.warn({
          message: 'Skipping offer upsert due to missing keys',
          platform: 'shopify',
          storeId: pipelineStoreId,
          sourceId: canonicalProduct?.sourceId || null
        });
      }

      summary.success += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error({
        message: 'Shopify product pipeline error',
        platform: 'shopify',
        storeId: pipelineStoreId,
        sourceId: rawProduct?.id || null,
        error: error?.message || String(error)
      });
    }
  }

  summary.duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
  logger.info({
    message: 'Shopify product pipeline complete',
    platform: 'shopify',
    storeId: pipelineStoreId,
    total: summary.total,
    success: summary.success,
    failed: summary.failed,
    duration: summary.duration
  });

  return summary;
}

module.exports = { runShopifyProductPipeline };