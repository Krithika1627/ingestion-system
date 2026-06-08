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
  buildGroupingKey,
  findExistingProductMatch,
  mergeMatchedProduct
} = require('../services/product-matching.service');
const {
  connectDB,
  upsertProduct,
  upsertRaw,
  upsertOffer,
  getCategoriesByStore,
  getStoreById
} = require('../services/db.service');
const {
  getOrCreateCanonical,
  mapSourceToCanonical
} = require('../services/canonical/canonical.service');
const {
  syncCanonicalPriceRange
} = require('../services/offer-aggregation/offer.aggregation.service');
const {
  updateCanonicalWithConflictResolution
} = require('../services/conflict-resolution/conflict.service');
const productSchema = require('../schemas/product.schema.json');

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validate = ajv.compile(productSchema);

function getAvailability(inventoryQty, isInStock) {
  if (typeof inventoryQty !== 'number') {
    return isInStock ? 'in_stock' : 'out_of_stock';
  }

  return inventoryQty > 0 ? 'in_stock' : 'out_of_stock';
}

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

async function buildCategoryIdSet(storeId, source) {
  const categories = await getCategoriesByStore(storeId, source);
  return new Set(categories.map((category) => category?.id).filter(Boolean));
}

function hasUnmatchedCategories(categoryIds, categoryIdSet, rawCategoryCount) {
  const normalized = Array.isArray(categoryIds) ? categoryIds.filter(Boolean) : [];
  if (rawCategoryCount > 0 && normalized.length === 0) {
    return true;
  }
  if (normalized.length === 0) {
    return false;
  }
  if (!(categoryIdSet instanceof Set) || categoryIdSet.size === 0) {
    return true;
  }
  return normalized.some((id) => !categoryIdSet.has(id));
}

async function runShopifyProductPipeline(storeId, since) {
  const pipelineStoreId = storeId || 'store_shopify_001';
  const startTime = Date.now();

  await connectDB();

  const rawProducts = await fetchShopifyProducts(pipelineStoreId, since);
  const summary = {
    total: rawProducts.length,
    success: 0,
    failed: 0,
    duplicateProducts: 0,
    missingBrands: 0,
    missingSkus: 0,
    unmatchedCategories: 0,
    orphanOffers: 0,
    invalidProducts: 0,
    canonicalProductsMapped: 0,
    canonicalSyncsFailed: 0,
    priceRangeSyncDuration: 0,
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

      let canonicalProduct = transformShopifyProduct(rawProduct, pipelineStoreId);
      canonicalProduct.groupingKey = buildGroupingKey(canonicalProduct);

      if (!canonicalProduct?.brand) {
        summary.missingBrands += 1;
      }
      if (!canonicalProduct?.sku) {
        summary.missingSkus += 1;
      }

      const isValid = validate(canonicalProduct);

      if (!isValid) {
        summary.failed += 1;
        summary.invalidProducts += 1;
        logger.warn({
          message: 'Shopify product validation failed',
          platform: 'shopify',
          storeId: pipelineStoreId,
          sourceId: canonicalProduct?.sourceId || null,
          errors: validate.errors
        });
        continue;
      }

      const groupingKey = canonicalProduct?.groupingKey || null;
      const matchResult = await findExistingProductMatch(pipelineStoreId, canonicalProduct);
      if (matchResult?.match) {
        const isSameSource =
          matchResult.match?.source === canonicalProduct?.source &&
          matchResult.match?.sourceId === canonicalProduct?.sourceId;
        if (!isSameSource) {
          summary.duplicateProducts += 1;
        }
        logger.info({
          message: 'Existing canonical product matched',
          platform: 'shopify',
          storeId: pipelineStoreId,
          sku: canonicalProduct?.sku || null,
          groupingKey,
          matchType: matchResult.matchType,
          canonicalProductId: matchResult.match?.id || null
        });
        canonicalProduct = mergeMatchedProduct(matchResult.match, canonicalProduct);
      } else {
        logger.info({
          message: 'New canonical product created',
          platform: 'shopify',
          storeId: pipelineStoreId,
          sku: canonicalProduct?.sku || null,
          groupingKey
        });
      }

      const canonicalResult = await getOrCreateCanonical(canonicalProduct);
      if (canonicalResult?.canonical?.canonicalId) {
        canonicalProduct.canonicalProductId = canonicalResult.canonical.canonicalId;
      } else {
        logger.warn({
          message: 'Shopify canonical mapping skipped',
          platform: 'shopify',
          storeId: pipelineStoreId,
          sourceId: canonicalProduct?.sourceId || null
        });
      }

      const variants = Array.isArray(canonicalProduct?.variants)
        ? canonicalProduct.variants
        : [];

      let offerUpsertsForProduct = 0;
      await upsertProduct(canonicalProduct);
      logger.info({
        message: 'Shopify product upserted',
        platform: 'shopify',
        storeId: pipelineStoreId,
        sourceId: canonicalProduct?.sourceId || null
      });

      if (variants.length === 0) {
        logger.warn({
          message: 'Skipping offer upserts due to missing variants',
          platform: 'shopify',
          storeId: pipelineStoreId,
          sourceId: canonicalProduct?.sourceId || null
        });
      } else {
        const offerTasks = variants.map((variant) => {
          const offerRecord = buildOfferFromVariant(canonicalProduct, variant);
          return upsertOffer(offerRecord)
            .then((upserted) => ({ upserted, offerRecord, variant }));
        });
        const offerResults = await Promise.allSettled(offerTasks);

        for (const result of offerResults) {
          if (result.status === 'fulfilled') {
            const { upserted, offerRecord } = result.value;
            if (upserted) {
              offerUpsertsForProduct += 1;
              logger.info({
                message: 'Shopify offer upserted',
                platform: 'shopify',
                storeId: pipelineStoreId,
                sourceId: offerRecord?.sourceId || null,
                variantId: offerRecord?.variantId || null
              });
            } else {
              summary.orphanOffers += 1;
            }
          } else {
            const failedVariant = result.reason?.variantId || null;
            summary.orphanOffers += 1;
            logger.error({
              message: 'Shopify offer upsert failed',
              platform: 'shopify',
              storeId: pipelineStoreId,
              sourceId: canonicalProduct?.sourceId || null,
              variantId: failedVariant,
              error: result.reason?.message || String(result.reason)
            });
          }
        }

        if (variants.length > 0 && offerUpsertsForProduct === 0) {
          throw new Error('Shopify offer upserts failed for product');
        }
      }

      if (canonicalResult?.canonical?.canonicalId) {
        const mapping = await mapSourceToCanonical(
          canonicalProduct,
          canonicalResult.canonical.canonicalId
        );

        if (mapping?.success) {
          summary.canonicalProductsMapped += 1;
          logger.info({
            message: 'Shopify canonical mapping complete',
            platform: 'shopify',
            storeId: pipelineStoreId,
            sourceId: canonicalProduct?.sourceId || null,
            canonicalId: canonicalResult.canonical.canonicalId
          });
        } else {
          logger.warn({
            message: 'Shopify canonical mapping failed',
            platform: 'shopify',
            storeId: pipelineStoreId,
            sourceId: canonicalProduct?.sourceId || null,
            canonicalId: canonicalResult.canonical.canonicalId
          });
        }

        const conflictResult = await updateCanonicalWithConflictResolution(
          canonicalResult.canonical.canonicalId,
          canonicalProduct
        );
        const conflictCount = Array.isArray(conflictResult?.conflicts)
          ? conflictResult.conflicts.length
          : 0;
        if (conflictCount > 0) {
          logger.info({
            message: 'Shopify canonical conflicts resolved',
            platform: 'shopify',
            storeId: pipelineStoreId,
            canonicalId: canonicalResult.canonical.canonicalId,
            conflictCount
          });
        }
      }

      if (canonicalProduct?.canonicalProductId && offerUpsertsForProduct > 0) {
        const syncStart = Date.now();
        try {
          const priceRange = await syncCanonicalPriceRange(
            canonicalProduct.canonicalProductId
          );
          const syncDuration = Number(((Date.now() - syncStart) / 1000).toFixed(2));
          summary.priceRangeSyncDuration += syncDuration;
          const syncFailed =
            !priceRange ||
            (!Number.isFinite(priceRange.min) &&
              !Number.isFinite(priceRange.max) &&
              !priceRange.currency);

          if (syncFailed) {
            summary.canonicalSyncsFailed += 1;
            logger.warn({
              message: 'Shopify canonical price range sync returned empty range',
              platform: 'shopify',
              storeId: pipelineStoreId,
              canonicalProductId: canonicalProduct.canonicalProductId,
              priceRange,
              duration: syncDuration
            });
          } else {
            logger.info({
              message: 'Shopify canonical price range synced',
              platform: 'shopify',
              storeId: pipelineStoreId,
              canonicalProductId: canonicalProduct.canonicalProductId,
              priceRange,
              duration: syncDuration
            });
          }
        } catch (error) {
          const syncDuration = Number(((Date.now() - syncStart) / 1000).toFixed(2));
          summary.priceRangeSyncDuration += syncDuration;
          summary.canonicalSyncsFailed += 1;
          logger.warn({
            message: 'Shopify canonical price range sync failed',
            platform: 'shopify',
            storeId: pipelineStoreId,
            canonicalProductId: canonicalProduct.canonicalProductId,
            duration: syncDuration,
            error: error?.message || String(error)
          });
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
        error: error?.message || String(error),
        stack: error?.stack || null
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
    duration: summary.duration,
    canonicalProductsMapped: summary.canonicalProductsMapped,
    canonicalSyncsFailed: summary.canonicalSyncsFailed,
    priceRangeSyncDuration: summary.priceRangeSyncDuration
  });

  return summary;
}

async function runMagentoProductPipeline(storeId, since) {
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

  const rawProducts = await fetchMagentoProducts({ id: pipelineStoreId }, since);
  const summary = {
    total: rawProducts.length,
    success: 0,
    failed: 0,
    duplicateProducts: 0,
    missingBrands: 0,
    missingSkus: 0,
    unmatchedCategories: 0,
    orphanOffers: 0,
    invalidProducts: 0,
    canonicalProductsMapped: 0,
    canonicalSyncsFailed: 0,
    priceRangeSyncDuration: 0,
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

      let canonicalProduct = transformMagentoProduct(
        rawProduct,
        storeRecord,
        storeBaseUrl
      );
      canonicalProduct.groupingKey = buildGroupingKey(canonicalProduct);

      if (!canonicalProduct?.brand) {
        summary.missingBrands += 1;
      }
      if (!canonicalProduct?.sku) {
        summary.missingSkus += 1;
      }

      const isValid = validate(canonicalProduct);

      if (!isValid) {
        summary.failed += 1;
        summary.invalidProducts += 1;
        logger.warn({
          message: 'Magento product validation failed',
          platform: 'magento',
          storeId: pipelineStoreId,
          sourceId: canonicalProduct?.sourceId || null,
          errors: validate.errors
        });
        continue;
      }

      const groupingKey = canonicalProduct?.groupingKey || null;
      const matchResult = await findExistingProductMatch(pipelineStoreId, canonicalProduct);
      if (matchResult?.match) {
        const isSameSource =
          matchResult.match?.source === canonicalProduct?.source &&
          matchResult.match?.sourceId === canonicalProduct?.sourceId;
        if (!isSameSource) {
          summary.duplicateProducts += 1;
        }
        logger.info({
          message: 'Existing canonical product matched',
          platform: 'magento',
          storeId: pipelineStoreId,
          sku: canonicalProduct?.sku || null,
          groupingKey,
          matchType: matchResult.matchType,
          canonicalProductId: matchResult.match?.id || null
        });
        canonicalProduct = mergeMatchedProduct(matchResult.match, canonicalProduct);
      } else {
        logger.info({
          message: 'New canonical product created',
          platform: 'magento',
          storeId: pipelineStoreId,
          sku: canonicalProduct?.sku || null,
          groupingKey
        });
      }

      const canonicalResult = await getOrCreateCanonical(canonicalProduct);
      if (canonicalResult?.canonical?.canonicalId) {
        canonicalProduct.canonicalProductId = canonicalResult.canonical.canonicalId;
      } else {
        logger.warn({
          message: 'Magento canonical mapping skipped',
          platform: 'magento',
          storeId: pipelineStoreId,
          sourceId: canonicalProduct?.sourceId || null
        });
      }

      const stockQty =
        typeof rawProduct?.extension_attributes?.stock_item?.qty === 'number'
          ? rawProduct.extension_attributes.stock_item.qty
          : null;
      let offerUpserted = false;
      await upsertProduct(canonicalProduct);
      logger.info({
        message: 'Magento product upserted',
        platform: 'magento',
        storeId: pipelineStoreId,
        sourceId: canonicalProduct?.sourceId || null
      });

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
      offerUpserted = Boolean(upserted);
      if (upserted) {
        logger.info({
          message: 'Magento offer upserted',
          platform: 'magento',
          storeId: pipelineStoreId,
          sourceId: offerRecord?.sourceId || null,
          variantId: offerRecord?.variantId || null
        });
      } else {
        summary.orphanOffers += 1;
        throw new Error('Magento offer upsert failed for product');
      }

      if (canonicalResult?.canonical?.canonicalId) {
        const mapping = await mapSourceToCanonical(
          canonicalProduct,
          canonicalResult.canonical.canonicalId
        );

        if (mapping?.success) {
          summary.canonicalProductsMapped += 1;
          logger.info({
            message: 'Magento canonical mapping complete',
            platform: 'magento',
            storeId: pipelineStoreId,
            sourceId: canonicalProduct?.sourceId || null,
            canonicalId: canonicalResult.canonical.canonicalId
          });
        } else {
          logger.warn({
            message: 'Magento canonical mapping failed',
            platform: 'magento',
            storeId: pipelineStoreId,
            sourceId: canonicalProduct?.sourceId || null,
            canonicalId: canonicalResult.canonical.canonicalId
          });
        }

        const conflictResult = await updateCanonicalWithConflictResolution(
          canonicalResult.canonical.canonicalId,
          canonicalProduct
        );
        const conflictCount = Array.isArray(conflictResult?.conflicts)
          ? conflictResult.conflicts.length
          : 0;
        if (conflictCount > 0) {
          logger.info({
            message: 'Magento canonical conflicts resolved',
            platform: 'magento',
            storeId: pipelineStoreId,
            canonicalId: canonicalResult.canonical.canonicalId,
            conflictCount
          });
        }
      }

      if (canonicalProduct?.canonicalProductId && offerUpserted) {
        const syncStart = Date.now();
        try {
          const priceRange = await syncCanonicalPriceRange(
            canonicalProduct.canonicalProductId
          );
          const syncDuration = Number(((Date.now() - syncStart) / 1000).toFixed(2));
          summary.priceRangeSyncDuration += syncDuration;
          const syncFailed =
            !priceRange ||
            (!Number.isFinite(priceRange.min) &&
              !Number.isFinite(priceRange.max) &&
              !priceRange.currency);

          if (syncFailed) {
            summary.canonicalSyncsFailed += 1;
            logger.warn({
              message: 'Magento canonical price range sync returned empty range',
              platform: 'magento',
              storeId: pipelineStoreId,
              canonicalProductId: canonicalProduct.canonicalProductId,
              priceRange,
              duration: syncDuration
            });
          } else {
            logger.info({
              message: 'Magento canonical price range synced',
              platform: 'magento',
              storeId: pipelineStoreId,
              canonicalProductId: canonicalProduct.canonicalProductId,
              priceRange,
              duration: syncDuration
            });
          }
        } catch (error) {
          const syncDuration = Number(((Date.now() - syncStart) / 1000).toFixed(2));
          summary.priceRangeSyncDuration += syncDuration;
          summary.canonicalSyncsFailed += 1;
          logger.warn({
            message: 'Magento canonical price range sync failed',
            platform: 'magento',
            storeId: pipelineStoreId,
            canonicalProductId: canonicalProduct.canonicalProductId,
            duration: syncDuration,
            error: error?.message || String(error)
          });
        }
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
    duration: summary.duration,
    canonicalProductsMapped: summary.canonicalProductsMapped,
    canonicalSyncsFailed: summary.canonicalSyncsFailed,
    priceRangeSyncDuration: summary.priceRangeSyncDuration
  });

  return summary;
}

async function runWooProductPipeline(storeId, since) {
  const pipelineStoreId = storeId || 'store_woo_001';
  const startTime = Date.now();

  await connectDB();

  const storeRecord = await getStoreById(pipelineStoreId);
  const threshold = storeRecord?.syncConfig?.availabilityThreshold ?? 10;

  const rawProducts = await fetchWooProducts({
    id: pipelineStoreId,
    syncConfig: storeRecord?.syncConfig || {}
  }, since);
  const summary = {
    total: rawProducts.length,
    success: 0,
    failed: 0,
    duplicateProducts: 0,
    missingBrands: 0,
    missingSkus: 0,
    unmatchedCategories: 0,
    orphanOffers: 0,
    invalidProducts: 0,
    canonicalProductsMapped: 0,
    canonicalSyncsFailed: 0,
    priceRangeSyncDuration: 0,
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

      let canonicalProduct = transformWooProduct(rawProduct, pipelineStoreId);
      canonicalProduct.groupingKey = buildGroupingKey(canonicalProduct);

      if (!canonicalProduct?.brand) {
        summary.missingBrands += 1;
      }
      if (!canonicalProduct?.sku) {
        summary.missingSkus += 1;
      }

      const isValid = validate(canonicalProduct);

      if (!isValid) {
        summary.failed += 1;
        summary.invalidProducts += 1;
        logger.warn({
          message: 'WooCommerce product validation failed',
          platform: 'woocommerce',
          storeId: pipelineStoreId,
          sourceId: canonicalProduct?.sourceId || null,
          errors: validate.errors
        });
        continue;
      }

      const groupingKey = canonicalProduct?.groupingKey || null;
      const matchResult = await findExistingProductMatch(pipelineStoreId, canonicalProduct);
      if (matchResult?.match) {
        const isSameSource =
          matchResult.match?.source === canonicalProduct?.source &&
          matchResult.match?.sourceId === canonicalProduct?.sourceId;
        if (!isSameSource) {
          summary.duplicateProducts += 1;
        }
        logger.info({
          message: 'Existing canonical product matched',
          platform: 'woocommerce',
          storeId: pipelineStoreId,
          sku: canonicalProduct?.sku || null,
          groupingKey,
          matchType: matchResult.matchType,
          canonicalProductId: matchResult.match?.id || null
        });
        canonicalProduct = mergeMatchedProduct(matchResult.match, canonicalProduct);
      } else {
        logger.info({
          message: 'New canonical product created',
          platform: 'woocommerce',
          storeId: pipelineStoreId,
          sku: canonicalProduct?.sku || null,
          groupingKey
        });
      }

      const canonicalResult = await getOrCreateCanonical(canonicalProduct);
      if (canonicalResult?.canonical?.canonicalId) {
        canonicalProduct.canonicalProductId = canonicalResult.canonical.canonicalId;
      } else {
        logger.warn({
          message: 'WooCommerce canonical mapping skipped',
          platform: 'woocommerce',
          storeId: pipelineStoreId,
          sourceId: canonicalProduct?.sourceId || null
        });
      }

      const price = parseNumber(rawProduct?.price);
      const regularPrice = parseNumber(rawProduct?.regular_price);
      const salePrice = parseNumber(rawProduct?.sale_price);
      const onSale = Boolean(rawProduct?.on_sale);
      const discountPercent =
        onSale && Number.isFinite(regularPrice) && Number.isFinite(salePrice) && regularPrice
          ? Number((((regularPrice - salePrice) / regularPrice) * 100).toFixed(2))
          : null;

      let offerUpserted = false;
      await upsertProduct(canonicalProduct);
      logger.info({
        message: 'WooCommerce product upserted',
        platform: 'woocommerce',
        storeId: pipelineStoreId,
        sourceId: canonicalProduct?.sourceId || null
      });

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
      offerUpserted = Boolean(upserted);
      if (upserted) {
        logger.info({
          message: 'WooCommerce offer upserted',
          platform: 'woocommerce',
          storeId: pipelineStoreId,
          sourceId: offerRecord?.sourceId || null,
          variantId: offerRecord?.variantId || null
        });
      } else {
        summary.orphanOffers += 1;
        throw new Error('WooCommerce offer upsert failed for product');
      }

      if (canonicalResult?.canonical?.canonicalId) {
        const mapping = await mapSourceToCanonical(
          canonicalProduct,
          canonicalResult.canonical.canonicalId
        );

        if (mapping?.success) {
          summary.canonicalProductsMapped += 1;
          logger.info({
            message: 'WooCommerce canonical mapping complete',
            platform: 'woocommerce',
            storeId: pipelineStoreId,
            sourceId: canonicalProduct?.sourceId || null,
            canonicalId: canonicalResult.canonical.canonicalId
          });
        } else {
          logger.warn({
            message: 'WooCommerce canonical mapping failed',
            platform: 'woocommerce',
            storeId: pipelineStoreId,
            sourceId: canonicalProduct?.sourceId || null,
            canonicalId: canonicalResult.canonical.canonicalId
          });
        }

        const conflictResult = await updateCanonicalWithConflictResolution(
          canonicalResult.canonical.canonicalId,
          canonicalProduct
        );
        const conflictCount = Array.isArray(conflictResult?.conflicts)
          ? conflictResult.conflicts.length
          : 0;
        if (conflictCount > 0) {
          logger.info({
            message: 'WooCommerce canonical conflicts resolved',
            platform: 'woocommerce',
            storeId: pipelineStoreId,
            canonicalId: canonicalResult.canonical.canonicalId,
            conflictCount
          });
        }
      }

      if (canonicalProduct?.canonicalProductId && offerUpserted) {
        const syncStart = Date.now();
        try {
          const priceRange = await syncCanonicalPriceRange(
            canonicalProduct.canonicalProductId
          );
          const syncDuration = Number(((Date.now() - syncStart) / 1000).toFixed(2));
          summary.priceRangeSyncDuration += syncDuration;
          const syncFailed =
            !priceRange ||
            (!Number.isFinite(priceRange.min) &&
              !Number.isFinite(priceRange.max) &&
              !priceRange.currency);

          if (syncFailed) {
            summary.canonicalSyncsFailed += 1;
            logger.warn({
              message: 'WooCommerce canonical price range sync returned empty range',
              platform: 'woocommerce',
              storeId: pipelineStoreId,
              canonicalProductId: canonicalProduct.canonicalProductId,
              priceRange,
              duration: syncDuration
            });
          } else {
            logger.info({
              message: 'WooCommerce canonical price range synced',
              platform: 'woocommerce',
              storeId: pipelineStoreId,
              canonicalProductId: canonicalProduct.canonicalProductId,
              priceRange,
              duration: syncDuration
            });
          }
        } catch (error) {
          const syncDuration = Number(((Date.now() - syncStart) / 1000).toFixed(2));
          summary.priceRangeSyncDuration += syncDuration;
          summary.canonicalSyncsFailed += 1;
          logger.warn({
            message: 'WooCommerce canonical price range sync failed',
            platform: 'woocommerce',
            storeId: pipelineStoreId,
            canonicalProductId: canonicalProduct.canonicalProductId,
            duration: syncDuration,
            error: error?.message || String(error)
          });
        }
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
    duration: summary.duration,
    canonicalProductsMapped: summary.canonicalProductsMapped,
    canonicalSyncsFailed: summary.canonicalSyncsFailed,
    priceRangeSyncDuration: summary.priceRangeSyncDuration
  });

  return summary;
}

async function runBigCommerceProductPipeline(storeId, since) {
  const pipelineStoreId = storeId || 'store_bigcommerce_001';
  const startTime = Date.now();

  await connectDB();

  const storeRecord = await getStoreById(pipelineStoreId);
  const threshold = storeRecord?.syncConfig?.availabilityThreshold ?? 10;

  const fetchResult = await fetchBigCommerceProducts({
    id: pipelineStoreId,
    syncConfig: storeRecord?.syncConfig || {}
  }, since);

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
  const categoryIdSet = new Set(
    categories
      .map((category) => category?.id)
      .filter(Boolean)
  );

  const summary = {
    total: rawProducts.length,
    success: 0,
    failed: 0,
    duplicateProducts: 0,
    missingBrands: 0,
    missingSkus: 0,
    unmatchedCategories: 0,
    orphanOffers: 0,
    invalidProducts: 0,
    canonicalProductsMapped: 0,
    canonicalSyncsFailed: 0,
    priceRangeSyncDuration: 0,
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

      let canonicalProduct = transformBigCommerceProduct(rawProduct, pipelineStoreId, {
        categoryIdMap,
        brandMap
      });
      canonicalProduct.groupingKey = buildGroupingKey(canonicalProduct);

      if (!canonicalProduct?.brand) {
        summary.missingBrands += 1;
      }
      if (!canonicalProduct?.sku) {
        summary.missingSkus += 1;
      }

      const isValid = validate(canonicalProduct);

      if (!isValid) {
        summary.failed += 1;
        summary.invalidProducts += 1;
        logger.warn({
          message: 'BigCommerce product validation failed',
          platform: 'bigcommerce',
          storeId: pipelineStoreId,
          sourceId: canonicalProduct?.sourceId || null,
          errors: validate.errors
        });
        continue;
      }

      const groupingKey = canonicalProduct?.groupingKey || null;
      const matchResult = await findExistingProductMatch(pipelineStoreId, canonicalProduct);
      if (matchResult?.match) {
        const isSameSource =
          matchResult.match?.source === canonicalProduct?.source &&
          matchResult.match?.sourceId === canonicalProduct?.sourceId;
        if (!isSameSource) {
          summary.duplicateProducts += 1;
        }
        logger.info({
          message: 'Existing canonical product matched',
          platform: 'bigcommerce',
          storeId: pipelineStoreId,
          sku: canonicalProduct?.sku || null,
          groupingKey,
          matchType: matchResult.matchType,
          canonicalProductId: matchResult.match?.id || null
        });
        canonicalProduct = mergeMatchedProduct(matchResult.match, canonicalProduct);
      } else {
        logger.info({
          message: 'New canonical product created',
          platform: 'bigcommerce',
          storeId: pipelineStoreId,
          sku: canonicalProduct?.sku || null,
          groupingKey
        });
      }

      const canonicalResult = await getOrCreateCanonical(canonicalProduct);
      if (canonicalResult?.canonical?.canonicalId) {
        canonicalProduct.canonicalProductId = canonicalResult.canonical.canonicalId;
      } else {
        logger.warn({
          message: 'BigCommerce canonical mapping skipped',
          platform: 'bigcommerce',
          storeId: pipelineStoreId,
          sourceId: canonicalProduct?.sourceId || null
        });
      }

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

      let offerUpserted = false;
      await upsertProduct(canonicalProduct);
      logger.info({
        message: 'BigCommerce product upserted',
        platform: 'bigcommerce',
        storeId: pipelineStoreId,
        sourceId: canonicalProduct?.sourceId || null
      });

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
      offerUpserted = Boolean(upserted);
      if (upserted) {
        logger.info({
          message: 'BigCommerce offer upserted',
          platform: 'bigcommerce',
          storeId: pipelineStoreId,
          sourceId: offerRecord?.sourceId || null,
          variantId: offerRecord?.variantId || null
        });
      } else {
        summary.orphanOffers += 1;
        throw new Error('BigCommerce offer upsert failed for product');
      }

      if (canonicalResult?.canonical?.canonicalId) {
        const mapping = await mapSourceToCanonical(
          canonicalProduct,
          canonicalResult.canonical.canonicalId
        );

        if (mapping?.success) {
          summary.canonicalProductsMapped += 1;
          logger.info({
            message: 'BigCommerce canonical mapping complete',
            platform: 'bigcommerce',
            storeId: pipelineStoreId,
            sourceId: canonicalProduct?.sourceId || null,
            canonicalId: canonicalResult.canonical.canonicalId
          });
        } else {
          logger.warn({
            message: 'BigCommerce canonical mapping failed',
            platform: 'bigcommerce',
            storeId: pipelineStoreId,
            sourceId: canonicalProduct?.sourceId || null,
            canonicalId: canonicalResult.canonical.canonicalId
          });
        }

        const conflictResult = await updateCanonicalWithConflictResolution(
          canonicalResult.canonical.canonicalId,
          canonicalProduct
        );
        const conflictCount = Array.isArray(conflictResult?.conflicts)
          ? conflictResult.conflicts.length
          : 0;
        if (conflictCount > 0) {
          logger.info({
            message: 'BigCommerce canonical conflicts resolved',
            platform: 'bigcommerce',
            storeId: pipelineStoreId,
            canonicalId: canonicalResult.canonical.canonicalId,
            conflictCount
          });
        }
      }

      if (canonicalProduct?.canonicalProductId && offerUpserted) {
        const syncStart = Date.now();
        try {
          const priceRange = await syncCanonicalPriceRange(
            canonicalProduct.canonicalProductId
          );
          const syncDuration = Number(((Date.now() - syncStart) / 1000).toFixed(2));
          summary.priceRangeSyncDuration += syncDuration;
          const syncFailed =
            !priceRange ||
            (!Number.isFinite(priceRange.min) &&
              !Number.isFinite(priceRange.max) &&
              !priceRange.currency);

          if (syncFailed) {
            summary.canonicalSyncsFailed += 1;
            logger.warn({
              message: 'BigCommerce canonical price range sync returned empty range',
              platform: 'bigcommerce',
              storeId: pipelineStoreId,
              canonicalProductId: canonicalProduct.canonicalProductId,
              priceRange,
              duration: syncDuration
            });
          } else {
            logger.info({
              message: 'BigCommerce canonical price range synced',
              platform: 'bigcommerce',
              storeId: pipelineStoreId,
              canonicalProductId: canonicalProduct.canonicalProductId,
              priceRange,
              duration: syncDuration
            });
          }
        } catch (error) {
          const syncDuration = Number(((Date.now() - syncStart) / 1000).toFixed(2));
          summary.priceRangeSyncDuration += syncDuration;
          summary.canonicalSyncsFailed += 1;
          logger.warn({
            message: 'BigCommerce canonical price range sync failed',
            platform: 'bigcommerce',
            storeId: pipelineStoreId,
            canonicalProductId: canonicalProduct.canonicalProductId,
            duration: syncDuration,
            error: error?.message || String(error)
          });
        }
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
    duration: summary.duration,
    canonicalProductsMapped: summary.canonicalProductsMapped,
    canonicalSyncsFailed: summary.canonicalSyncsFailed,
    priceRangeSyncDuration: summary.priceRangeSyncDuration
  });

  return summary;
}

module.exports = {
  runShopifyProductPipeline,
  runMagentoProductPipeline,
  runWooProductPipeline,
  runBigCommerceProductPipeline
};