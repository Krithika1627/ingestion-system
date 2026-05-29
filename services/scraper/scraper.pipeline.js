const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const logger = require('../logger.service');
const { randomBytes } = require('crypto');
const {
  connectDB,
  upsertProduct,
  upsertOffer,
  upsertRaw,
  getRawResponseBySourceId
} = require('../db.service');
const {
  buildGroupingKey,
  findExistingProductMatch,
  mergeMatchedProduct
} = require('../product-matching.service');
const { findDuplicates } = require('../deduplication/dedup.service');
const {
  getOrCreateCanonical,
  mapSourceToCanonical
} = require('../canonical/canonical.service');
const {
  syncCanonicalPriceRange
} = require('../offer-aggregation/offer.aggregation.service');
const {
  updateCanonicalWithConflictResolution
} = require('../conflict-resolution/conflict.service');
const productSchema = require('../../schemas/product.schema.json');

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validate = ajv.compile(productSchema);

function getAvailabilityFromVariant(variant) {
  if (typeof variant?.inventoryQty === 'number') {
    return variant.inventoryQty > 0 ? 'in_stock' : 'out_of_stock';
  }
  return variant?.isInStock ? 'in_stock' : 'out_of_stock';
}

function buildOfferFromVariant(product, variant) {
  return {
    sourceId: product?.sourceId || null,
    storeId: product?.storeId || null,
    productId: product?.id || null,
    variantId: variant?.variantId || null,
    sku: variant?.sku ?? product?.sku ?? null,
    price: variant?.price ?? null,
    compareAtPrice: variant?.compareAtPrice ?? null,
    currency: variant?.currency ?? null,
    inventoryQty: variant?.inventoryQty ?? null,
    isInStock: variant?.isInStock ?? false,
    availability: getAvailabilityFromVariant(variant),
    source: product?.source || 'scraped',
    lastSyncedAt: product?.lastSyncedAt || new Date().toISOString()
  };
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function generateNanoId(size = 16) {
  const bytes = randomBytes(size);
  let output = '';
  for (let i = 0; i < bytes.length; i += 1) {
    output += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return output;
}

function generateProductId() {
  return `prod_${generateNanoId(16)}`;
}

async function persistRawHtmlIfMissing(product, rawHtml) {
  if (!product?.sourceId || !rawHtml) {
    return false;
  }

  const existing = await getRawResponseBySourceId(
    'scraped',
    product.sourceId,
    product.storeId
  );
  if (existing) {
    return false;
  }

  await upsertRaw('scraped', {
    sourceId: product.sourceId,
    storeId: product.storeId,
    data: {
      url: product.sourceId,
      html: rawHtml
    }
  });

  return true;
}

async function runScraperProductPipeline(products, storeId) {
  const startTime = Date.now();
  const items = Array.isArray(products) ? products : [];

  await connectDB();

  const summary = {
    total: items.length,
    success: 0,
    failed: 0,
    duplicateProducts: 0,
    invalidProducts: 0,
    offersCreated: 0,
    priceRangeSyncDuration: 0,
    duration: 0
  };

  for (const item of items) {
    const productInput = item?.product || item;
    const rawHtml = item?.rawHtml || item?.html || null;

    if (!productInput) {
      summary.failed += 1;
      continue;
    }

    try {
      let canonicalProduct = {
        ...productInput,
        storeId: storeId || productInput?.storeId || null,
        source: 'scraped',
        lastSyncedAt: new Date().toISOString()
      };
      canonicalProduct.groupingKey = buildGroupingKey(canonicalProduct);

      if (!canonicalProduct.id) {
        canonicalProduct.id = generateProductId();
      }

      const isValid = validate(canonicalProduct);
      if (!isValid) {
        summary.failed += 1;
        summary.invalidProducts += 1;
        logger.warn({
          message: 'Scraped product validation failed',
          platform: 'scraped',
          storeId: canonicalProduct?.storeId || null,
          sourceId: canonicalProduct?.sourceId || null,
          errors: validate.errors
        });
        continue;
      }

      const dedupResult = await findDuplicates(canonicalProduct);
      const isDuplicate = Boolean(dedupResult?.isDuplicate && dedupResult?.matchedProductId);
      if (isDuplicate) {
        summary.duplicateProducts += 1;
        canonicalProduct.id = dedupResult.matchedProductId;
        logger.info({
          message: 'Duplicate product matched',
          platform: 'scraped',
          storeId: canonicalProduct?.storeId || null,
          sourceId: canonicalProduct?.sourceId || null,
          matchedSourceId: dedupResult.matchedSourceId || null,
          confidence: dedupResult.confidence || null
        });
      }

      let canonicalResult = null;
      if (!isDuplicate) {
        if (!canonicalProduct.id) {
          canonicalProduct.id = generateProductId();
        }

        const matchResult = await findExistingProductMatch(
          canonicalProduct?.storeId,
          canonicalProduct
        );
        if (matchResult?.match) {
          const isSameSource =
            matchResult.match?.source === canonicalProduct?.source &&
            matchResult.match?.sourceId === canonicalProduct?.sourceId;
          if (!isSameSource) {
            summary.duplicateProducts += 1;
          }
          logger.info({
            message: 'Existing canonical product matched',
            platform: 'scraped',
            storeId: canonicalProduct?.storeId || null,
            sourceId: canonicalProduct?.sourceId || null,
            matchType: matchResult.matchType,
            canonicalProductId: matchResult.match?.id || null
          });
          canonicalProduct = mergeMatchedProduct(matchResult.match, canonicalProduct);
        }

        canonicalResult = await getOrCreateCanonical(canonicalProduct);
        if (canonicalResult?.canonical?.canonicalId) {
          canonicalProduct.canonicalProductId = canonicalResult.canonical.canonicalId;
        } else {
          logger.warn({
            message: 'Canonical mapping skipped',
            platform: 'scraped',
            sourceId: canonicalProduct?.sourceId || null
          });
        }
      }

      const rawPersisted = await persistRawHtmlIfMissing(canonicalProduct, rawHtml);
      if (rawPersisted) {
        logger.info({
          message: 'Scraped raw payload persisted',
          platform: 'scraped',
          storeId: canonicalProduct?.storeId || null,
          sourceId: canonicalProduct?.sourceId || null
        });
      }

      const variants = Array.isArray(canonicalProduct?.variants)
        ? canonicalProduct.variants
        : [];

      if (variants.length === 0) {
        logger.warn({
          message: 'Scraped product missing variants',
          platform: 'scraped',
          storeId: canonicalProduct?.storeId || null,
          sourceId: canonicalProduct?.sourceId || null
        });
      }

      let offerUpsertsForProduct = 0;
      if (!isDuplicate) {
        await upsertProduct(canonicalProduct);
        logger.info({
          message: 'Scraped product upserted',
          platform: 'scraped',
          storeId: canonicalProduct?.storeId || null,
          sourceId: canonicalProduct?.sourceId || null
        });

        const offerTasks = variants.map((variant) => {
          const offerRecord = buildOfferFromVariant(canonicalProduct, variant);
          return upsertOffer(offerRecord)
            .then((upserted) => ({ upserted, offerRecord }));
        });
        const offerResults = await Promise.allSettled(offerTasks);

        for (const result of offerResults) {
          if (result.status === 'fulfilled') {
            const { upserted, offerRecord } = result.value;
            if (upserted) {
              offerUpsertsForProduct += 1;
              summary.offersCreated += 1;
              logger.info({
                message: 'Scraped offer upserted',
                platform: 'scraped',
                storeId: canonicalProduct?.storeId || null,
                sourceId: offerRecord?.sourceId || null,
                variantId: offerRecord?.variantId || null
              });
            }
          } else {
            logger.error({
              message: 'Scraped offer upsert failed',
              platform: 'scraped',
              storeId: canonicalProduct?.storeId || null,
              sourceId: canonicalProduct?.sourceId || null,
              error: result.reason?.message || String(result.reason)
            });
          }
        }

        if (variants.length > 0 && offerUpsertsForProduct === 0) {
          throw new Error('Scraped offer upserts failed for product');
        }

        if (canonicalResult?.canonical?.canonicalId) {
          const mapping = await mapSourceToCanonical(
            canonicalProduct,
            canonicalResult.canonical.canonicalId
          );
          logger.info({
            message: 'Canonical mapping complete',
            platform: 'scraped',
            sourceId: canonicalProduct?.sourceId || null,
            canonicalId: canonicalResult.canonical.canonicalId,
            success: mapping?.success === true
          });

          const conflictResult = await updateCanonicalWithConflictResolution(
            canonicalResult.canonical.canonicalId,
            canonicalProduct
          );
          const conflictCount = Array.isArray(conflictResult?.conflicts)
            ? conflictResult.conflicts.length
            : 0;
          if (conflictCount > 0) {
            logger.info({
              message: 'Scraped canonical conflicts resolved',
              platform: 'scraped',
              storeId: canonicalProduct?.storeId || null,
              canonicalId: canonicalResult.canonical.canonicalId,
              conflictCount
            });
          }
        }
      } else {
        const offerTasks = variants.map((variant) => {
          const offerRecord = buildOfferFromVariant(canonicalProduct, variant);
          return upsertOffer(offerRecord).then((upserted) => ({ upserted, offerRecord }));
        });
        const offerResults = await Promise.allSettled(offerTasks);
        for (const result of offerResults) {
          if (result.status === 'fulfilled') {
            const { upserted, offerRecord } = result.value;
            if (upserted) {
              offerUpsertsForProduct += 1;
              summary.offersCreated += 1;
              logger.info({
                message: 'Scraped offer upserted',
                platform: 'scraped',
                storeId: canonicalProduct?.storeId || null,
                sourceId: offerRecord?.sourceId || null,
                variantId: offerRecord?.variantId || null
              });
            }
          } else {
            logger.error({
              message: 'Scraped offer upsert failed',
              platform: 'scraped',
              storeId: canonicalProduct?.storeId || null,
              sourceId: canonicalProduct?.sourceId || null,
              error: result.reason?.message || String(result.reason)
            });
          }
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
          logger.info({
            message: 'Scraped canonical price range synced',
            platform: 'scraped',
            storeId: canonicalProduct?.storeId || null,
            canonicalProductId: canonicalProduct.canonicalProductId,
            priceRange,
            duration: syncDuration
          });
        } catch (error) {
          const syncDuration = Number(((Date.now() - syncStart) / 1000).toFixed(2));
          summary.priceRangeSyncDuration += syncDuration;
          logger.warn({
            message: 'Scraped canonical price range sync failed',
            platform: 'scraped',
            storeId: canonicalProduct?.storeId || null,
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
        message: 'Scraped product pipeline error',
        platform: 'scraped',
        storeId: storeId || null,
        sourceId: productInput?.sourceId || null,
        error: error?.message || String(error)
      });
    }
  }

  summary.duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
  logger.info({
    message: 'Scraped product pipeline complete',
    platform: 'scraped',
    storeId: storeId || null,
    ...summary
  });

  return summary;
}

module.exports = { runScraperProductPipeline };
