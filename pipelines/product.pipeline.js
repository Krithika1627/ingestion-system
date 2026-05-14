/**
 * Shopify product pipeline: fetch raw data, transform, validate, and upsert.
 */
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { randomUUID } = require('crypto');
const logger = require('../services/logger.service');
const { fetchProducts: fetchShopifyProducts } = require('../connectors/shopify.connector');
const { fetchProducts: fetchMagentoProducts } = require('../connectors/magento.connector');
const { fetchProducts: fetchWooProducts } = require('../connectors/woocommerce.connector');
const { fetchProducts: fetchBigCommerceProducts } = require('../connectors/bigcommerce.connector');
const { transformProduct: transformShopifyProduct } = require('../transformers/shopify.transformer');
const { transformProduct: transformMagentoProduct } = require('../transformers/magento.transformer');
const { transformProduct: transformWooProduct } = require('../transformers/woocommerce.transformer');
const { transformProduct: transformBigCommerceProduct } = require('../transformers/bigcommerce.transformer');
const {
  connectDB,
  upsertProduct,
  upsertRaw,
  upsertOffer,
  getCategoriesByStore,
  getStoreById
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
 * Derive WooCommerce availability from stock status and quantity.
 * @param {number|null|undefined} qty
 * @param {string} stockStatus
 * @param {number} threshold
 * @returns {string}
 */
function deriveWooAvailability(qty, stockStatus, threshold = 10) {
  if (stockStatus === 'outofstock') {
    return 'out_of_stock';
  }
  if (stockStatus === 'onbackorder') {
    return 'on_backorder';
  }
  if (qty !== null && qty !== undefined && qty <= threshold) {
    return 'limited';
  }
  return 'in_stock';
}

function parseNumber(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
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

  const storeRecord = await getStoreById(pipelineStoreId);

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
        storeRecord,
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

/**
 * Run WooCommerce product ingestion pipeline.
 * @param {string} storeId
 * @returns {Promise<{total:number, success:number, failed:number, duration:number}>}
 */
async function runWooProductPipeline(storeId) {
  const pipelineStoreId = storeId || 'store_woo_001';
  const startTime = Date.now();

  await connectDB();

  const storeRecord = await getStoreById(pipelineStoreId);
  const threshold = storeRecord?.syncConfig?.availabilityThreshold ?? 10;

  const rawProducts = await fetchWooProducts({
    id: pipelineStoreId,
    syncConfig: storeRecord?.syncConfig || {}
  });
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

      await upsertRaw('woocommerce', rawPayload);

      const canonicalProduct = transformWooProduct(rawProduct, pipelineStoreId);
      const isValid = validate(canonicalProduct);

      if (!isValid) {
        summary.failed += 1;
        logger.warn({
          message: 'WooCommerce product validation failed',
          platform: 'woocommerce',
          storeId: pipelineStoreId,
          sourceId: canonicalProduct?.sourceId || null,
          errors: validate.errors
        });
        continue;
      }

      await upsertProduct(canonicalProduct);
      logger.info({
        message: 'WooCommerce product upserted',
        platform: 'woocommerce',
        storeId: pipelineStoreId,
        sourceId: canonicalProduct?.sourceId || null
      });

      const price = parseNumber(rawProduct?.price);
      const regularPrice = parseNumber(rawProduct?.regular_price);
      const salePrice = parseNumber(rawProduct?.sale_price);
      const onSale = Boolean(rawProduct?.on_sale);
      const discountPercent =
        onSale && Number.isFinite(regularPrice) && Number.isFinite(salePrice) && regularPrice
          ? Number((((regularPrice - salePrice) / regularPrice) * 100).toFixed(2))
          : null;

      const offerRecord = {
        id: randomUUID(),
        sourceId: sourceId,
        productId: canonicalProduct?.id || null,
        storeId: pipelineStoreId,
        variantId: rawProduct?.sku || sourceId,
        sku: rawProduct?.sku || null,
        price: Number.isFinite(price) ? price : 0,
        compareAtPrice: onSale && Number.isFinite(regularPrice) ? regularPrice : null,
        discountPercent,
        currency: 'INR',
        availability: deriveWooAvailability(
          rawProduct?.stock_quantity ?? null,
          rawProduct?.stock_status,
          threshold
        ),
        stockQty: rawProduct?.stock_quantity ?? null,
        lastSyncedAt: new Date().toISOString()
      };

      const upserted = await upsertOffer(offerRecord);
      if (upserted) {
        logger.info({
          message: 'WooCommerce offer upserted',
          platform: 'woocommerce',
          storeId: pipelineStoreId,
          sourceId: offerRecord?.sourceId || null,
          variantId: offerRecord?.variantId || null
        });
      }

      summary.success += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error({
        message: 'WooCommerce product pipeline error',
        platform: 'woocommerce',
        storeId: pipelineStoreId,
        sourceId: rawProduct?.id || null,
        error: error?.message || String(error)
      });
    }
  }

  summary.duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
  logger.info({
    message: 'WooCommerce product pipeline complete',
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
 * Run BigCommerce product ingestion pipeline.
 * @param {string} storeId
 * @returns {Promise<{total:number, success:number, failed:number, duration:number}>}
 */
async function runBigCommerceProductPipeline(storeId) {
  const pipelineStoreId = storeId || 'store_bigcommerce_001';
  const startTime = Date.now();

  await connectDB();

  const storeRecord = await getStoreById(pipelineStoreId);
  const threshold = storeRecord?.syncConfig?.availabilityThreshold ?? 10;

  const fetchResult = await fetchBigCommerceProducts({
    id: pipelineStoreId,
    syncConfig: storeRecord?.syncConfig || {}
  });

  const rawProducts = Array.isArray(fetchResult)
    ? fetchResult
    : Array.isArray(fetchResult?.products)
      ? fetchResult.products
      : [];

  const brandMap = fetchResult?.brandMap instanceof Map
    ? fetchResult.brandMap
    : fetchResult?.brandMap && typeof fetchResult.brandMap === 'object'
      ? fetchResult.brandMap
      : null;

  const categories = await getCategoriesByStore(pipelineStoreId, 'bigcommerce');
  const categoryIdMap = new Map(
    categories
      .filter((category) => category?.sourceId && category?.id)
      .map((category) => [String(category.sourceId), category.id])
  );

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

      await upsertRaw('bigcommerce', rawPayload);

      const canonicalProduct = transformBigCommerceProduct(rawProduct, pipelineStoreId, {
        categoryIdMap,
        brandMap
      });
      const isValid = validate(canonicalProduct);

      if (!isValid) {
        summary.failed += 1;
        logger.warn({
          message: 'BigCommerce product validation failed',
          platform: 'bigcommerce',
          storeId: pipelineStoreId,
          sourceId: canonicalProduct?.sourceId || null,
          errors: validate.errors
        });
        continue;
      }

      await upsertProduct(canonicalProduct);
      logger.info({
        message: 'BigCommerce product upserted',
        platform: 'bigcommerce',
        storeId: pipelineStoreId,
        sourceId: canonicalProduct?.sourceId || null
      });

      const tracking = rawProduct?.inventory_tracking;
      const primaryVariant = rawProduct?.variants?.[0] || null;
      const variantInventory = primaryVariant?.inventory_level;
      const productInventory = rawProduct?.inventory_level;
      const resolvedInventory = tracking === 'variant'
        ? (typeof variantInventory === 'number' ? variantInventory : productInventory)
        : productInventory;
      const stockQty = tracking === 'none'
        ? null
        : resolvedInventory ?? 0;

      const salePrice = parseNumber(rawProduct?.sale_price);
      const price = parseNumber(rawProduct?.price);
      const retailPrice = parseNumber(rawProduct?.retail_price);
      const hasSale = Number.isFinite(salePrice) && salePrice > 0;
      const effectivePrice = hasSale ? salePrice : Number.isFinite(price) ? price : 0;
      const compareAtPrice = hasSale && Number.isFinite(retailPrice) ? retailPrice : null;
      const discountPercent = hasSale && Number.isFinite(retailPrice) && retailPrice > 0
        ? Number((((retailPrice - salePrice) / retailPrice) * 100).toFixed(2))
        : null;

      const variantId = primaryVariant?.id !== undefined && primaryVariant?.id !== null
        ? String(primaryVariant.id)
        : rawProduct?.sku || sourceId;
      const sku = primaryVariant?.sku || rawProduct?.sku || null;

      const offerRecord = {
        id: randomUUID(),
        sourceId: sourceId,
        productId: canonicalProduct?.id || null,
        storeId: pipelineStoreId,
        variantId,
        sku,
        price: effectivePrice,
        compareAtPrice,
        discountPercent,
        currency: 'INR',
        availability: deriveAvailability(stockQty, threshold),
        stockQty,
        lastSyncedAt: new Date().toISOString()
      };

      const upserted = await upsertOffer(offerRecord);
      if (upserted) {
        logger.info({
          message: 'BigCommerce offer upserted',
          platform: 'bigcommerce',
          storeId: pipelineStoreId,
          sourceId: offerRecord?.sourceId || null,
          variantId: offerRecord?.variantId || null
        });
      }

      summary.success += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error({
        message: 'BigCommerce product pipeline error',
        platform: 'bigcommerce',
        storeId: pipelineStoreId,
        sourceId: rawProduct?.id || null,
        error: error?.message || String(error)
      });
    }
  }

  summary.duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
  logger.info({
    message: 'BigCommerce product pipeline complete',
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
  runShopifyProductPipeline,
  runMagentoProductPipeline,
  runWooProductPipeline,
  runBigCommerceProductPipeline
};