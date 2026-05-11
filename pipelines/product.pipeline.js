/**
 * Shopify product pipeline: fetch raw data, transform, validate, and upsert.
 */
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { randomUUID } = require('crypto');
const logger = require('../services/logger.service');
const { fetchProducts: fetchShopifyProducts } = require('../connectors/shopify.connector');
const { fetchProducts: fetchMagentoProducts } = require('../connectors/magento.connector');
const { transformProduct: transformShopifyProduct } = require('../transformers/shopify.transformer');
const { transformProduct: transformMagentoProduct } = require('../transformers/magento.transformer');
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

/**
 * Compute availability status from inventory and in-stock flag.
 * @param {number|null|undefined} inventoryQty
 * @param {boolean} isInStock
 * @returns {string}
 */
function getAvailability(inventoryQty, isInStock) {
  if (typeof inventoryQty !== 'number') {
    return isInStock ? 'in_stock' : 'out_of_stock';
  }

  return inventoryQty > 0 ? 'in_stock' : 'out_of_stock';
}

/**
 * Build an offer record from a product and variant.
 * @param {object} product
 * @param {object} variant
 * @returns {object}
 */
function buildOfferFromVariant(product, variant) {
  return {
    sourceId: product?.sourceId || null,
    storeId: product?.storeId || null,
    variantId: variant?.variantId || null,
    sku: variant?.sku ?? product?.sku ?? null,
    price: variant?.price ?? null,
    compareAtPrice: variant?.compareAtPrice ?? null,
    currency: variant?.currency ?? null,
    inventoryQty: variant?.inventoryQty ?? null,
    isInStock: variant?.isInStock ?? false,
    availability: getAvailability(variant?.inventoryQty, variant?.isInStock ?? false),
    lastSyncedAt: product?.lastSyncedAt || new Date().toISOString()
  };
}

/**
 * Derive Magento availability from stock quantity and threshold.
 * @param {number|null|undefined} qty
 * @param {number} threshold
 * @returns {string}
 */
function deriveAvailability(qty, threshold = 10) {
  if (qty === null || qty === undefined) {
    return 'in_stock';
  }
  if (qty === 0) {
    return 'out_of_stock';
  }
  if (qty <= threshold) {
    return 'limited';
  }
  return 'in_stock';
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

  const rawProducts = await fetchShopifyProducts(pipelineStoreId);
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

      const canonicalProduct = transformShopifyProduct(rawProduct, pipelineStoreId);
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

      const variants = Array.isArray(canonicalProduct?.variants)
        ? canonicalProduct.variants
        : [];

      if (variants.length === 0) {
        logger.warn({
          message: 'Skipping offer upserts due to missing variants',
          platform: 'shopify',
          storeId: pipelineStoreId,
          sourceId: canonicalProduct?.sourceId || null
        });
      } else {
        for (const variant of variants) {
          try {
            const offerRecord = buildOfferFromVariant(canonicalProduct, variant);
            const upserted = await upsertOffer(offerRecord);
            if (upserted) {
              logger.info({
                message: 'Shopify offer upserted',
                platform: 'shopify',
                storeId: pipelineStoreId,
                sourceId: offerRecord?.sourceId || null,
                variantId: offerRecord?.variantId || null
              });
            }
          } catch (error) {
            logger.error({
              message: 'Shopify offer upsert failed',
              platform: 'shopify',
              storeId: pipelineStoreId,
              sourceId: canonicalProduct?.sourceId || null,
              variantId: variant?.variantId || null,
              error: error?.message || String(error)
            });
          }
        }
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

/**
 * Run Magento product ingestion pipeline.
 * @param {string} storeId
 * @returns {Promise<{total:number, success:number, failed:number, duration:number}>}
 */
async function runMagentoProductPipeline(storeId) {
  const pipelineStoreId = storeId || 'store_magento_001';
  const startTime = Date.now();
  const storeBaseUrl = process.env.MAGENTO_STORE_URL || '';

  if (!storeBaseUrl) {
    logger.warn({
      message: 'MAGENTO_STORE_URL is not configured for image mapping',
      platform: 'magento',
      storeId: pipelineStoreId
    });
  }

  await connectDB();

  const rawProducts = await fetchMagentoProducts({ id: pipelineStoreId });
  const summary = {
    total: rawProducts.length,
    success: 0,
    failed: 0,
    duration: 0
  };

  for (const rawProduct of rawProducts) {
    try {
      const sourceId = rawProduct?.id !== undefined && rawProduct?.id !== null
        ? String(rawProduct.id)
        : null;
      const rawPayload = {
        storeId: pipelineStoreId,
        sourceId,
        data: rawProduct
      };

      await upsertRaw('magento', rawPayload);

      const canonicalProduct = transformMagentoProduct(
        rawProduct,
        pipelineStoreId,
        storeBaseUrl
      );
      const isValid = validate(canonicalProduct);

      if (!isValid) {
        summary.failed += 1;
        logger.warn({
          message: 'Magento product validation failed',
          platform: 'magento',
          storeId: pipelineStoreId,
          sourceId: canonicalProduct?.sourceId || null,
          errors: validate.errors
        });
        continue;
      }

      await upsertProduct(canonicalProduct);
      logger.info({
        message: 'Magento product upserted',
        platform: 'magento',
        storeId: pipelineStoreId,
        sourceId: canonicalProduct?.sourceId || null
      });

      const stockQty =
        typeof rawProduct?.extension_attributes?.stock_item?.qty === 'number'
          ? rawProduct.extension_attributes.stock_item.qty
          : null;
      const offerRecord = {
        id: randomUUID(),
        sourceId: canonicalProduct?.sourceId || null,
        productId: canonicalProduct?.id || null,
        storeId: pipelineStoreId,
        variantId: rawProduct?.sku || null,
        sku: rawProduct?.sku || null,
        price: typeof rawProduct?.price === 'number' ? rawProduct.price : null,
        compareAtPrice: null,
        discountPercent: null,
        currency: process.env.MAGENTO_CURRENCY || 'INR',
        availability: deriveAvailability(stockQty, 10),
        stockQty,
        lastSyncedAt: new Date().toISOString()
      };

      const upserted = await upsertOffer(offerRecord);
      if (upserted) {
        logger.info({
          message: 'Magento offer upserted',
          platform: 'magento',
          storeId: pipelineStoreId,
          sourceId: offerRecord?.sourceId || null,
          variantId: offerRecord?.variantId || null
        });
      }

      summary.success += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error({
        message: 'Magento product pipeline error',
        platform: 'magento',
        storeId: pipelineStoreId,
        sourceId: rawProduct?.id || null,
        error: error?.message || String(error)
      });
    }
  }

  summary.duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
  logger.info({
    message: 'Magento product pipeline complete',
    platform: 'magento',
    storeId: pipelineStoreId,
    total: summary.total,
    success: summary.success,
    failed: summary.failed,
    duration: summary.duration
  });

  return summary;
}

module.exports = { runShopifyProductPipeline, runMagentoProductPipeline };