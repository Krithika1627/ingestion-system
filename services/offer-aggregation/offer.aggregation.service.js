const mongoose = require('mongoose');
const logger = require('../logger.service');
const { connectDB } = require('../db.service');

function toIsoString(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizePrice(value) {
  if (Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isInStockStatus(status) {
  const normalized = typeof status === 'string' ? status.toLowerCase() : '';
  return normalized === 'in_stock' || normalized === 'limited' || normalized === 'limited_stock';
}

function getMostCommonCurrency(offers) {
  const counts = new Map();
  let topCurrency = null;
  let topCount = 0;

  for (const offer of offers) {
    const currency = typeof offer?.currency === 'string'
      ? offer.currency.toUpperCase()
      : null;
    if (!currency) {
      continue;
    }

    const nextCount = (counts.get(currency) || 0) + 1;
    counts.set(currency, nextCount);

    if (nextCount > topCount) {
      topCount = nextCount;
      topCurrency = currency;
    }
  }

  return topCurrency;
}

function buildProductLookupFilter(productId) {
  if (!productId) {
    return null;
  }

  const filters = [{ id: productId }];
  if (productId instanceof mongoose.Types.ObjectId) {
    filters.push({ _id: productId });
  } else if (typeof productId === 'string' && mongoose.Types.ObjectId.isValid(productId)) {
    filters.push({ _id: new mongoose.Types.ObjectId(productId) });
  }

  return filters.length > 1 ? { $or: filters } : filters[0];
}

async function backfillOfferCanonicalIds(options = {}) {
  const startTime = Date.now();
  const batchSize = Number.isFinite(options?.batchSize) ? options.batchSize : 100;
  const dryRun = Boolean(options?.dryRun);

  const summary = {
    total: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    duration: 0
  };

  try {
    await connectDB();
    const offersCollection = mongoose.connection.collection('offers');
    const productsCollection = mongoose.connection.collection('products');

    const filter = {
      $or: [
        { canonicalProductId: { $exists: false } },
        { canonicalProductId: null },
        { canonicalProductId: '' }
      ]
    };

    summary.total = await offersCollection.countDocuments(filter);

    const cursor = offersCollection.find(filter).batchSize(batchSize);
    let processed = 0;

    for await (const offer of cursor) {
      processed += 1;
      try {
        const productFilter = buildProductLookupFilter(offer?.productId || null);
        if (!productFilter) {
          summary.skipped += 1;
          continue;
        }

        const product = await productsCollection.findOne(productFilter, {
          projection: { canonicalProductId: 1 }
        });
        const canonicalProductId = product?.canonicalProductId || null;

        if (!canonicalProductId) {
          summary.skipped += 1;
          continue;
        }

        if (dryRun) {
          summary.updated += 1;
        } else {
          const updateFilter = offer?._id ? { _id: offer._id } : { id: offer?.id };
          const updateResult = await offersCollection.updateOne(
            updateFilter,
            {
              $set: {
                canonicalProductId,
                canonicalBackfilledAt: new Date()
              }
            }
          );

          if ((updateResult?.modifiedCount || 0) > 0) {
            summary.updated += 1;
          } else {
            summary.failed += 1;
          }
        }
      } catch (error) {
        summary.failed += 1;
        logger.error({
          message: 'Offer canonical backfill error',
          service: 'offer-aggregation',
          error: error?.message || String(error)
        });
      }

      if (processed % 100 === 0) {
        logger.info({
          message: 'Offer canonical backfill progress',
          service: 'offer-aggregation',
          processed,
          updated: summary.updated,
          skipped: summary.skipped,
          failed: summary.failed,
          total: summary.total,
          dryRun
        });
      }
    }
  } catch (error) {
    summary.failed += 1;
    logger.error({
      message: 'Offer canonical backfill failed',
      service: 'offer-aggregation',
      error: error?.message || String(error)
    });
  }

  summary.duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
  return summary;
}

async function aggregateOffers(canonicalProductId) {
  const result = {
    canonicalProductId: canonicalProductId || null,
    totalOffers: 0,
    offers: []
  };

  try {
    if (!canonicalProductId) {
      return result;
    }

    await connectDB();
    const offersCollection = mongoose.connection.collection('offers');
    const storesCollection = mongoose.connection.collection('stores');

    const offers = await offersCollection
      .find({ canonicalProductId })
      .toArray();

    const filtered = offers
      .map((offer) => ({
        ...offer,
        normalizedPrice: normalizePrice(offer?.price)
      }))
      .filter((offer) => Number.isFinite(offer.normalizedPrice));

    if (filtered.length === 0) {
      return result;
    }

    filtered.sort((a, b) => a.normalizedPrice - b.normalizedPrice);

    const storeIds = Array.from(
      new Set(filtered.map((offer) => offer?.storeId).filter(Boolean))
    );
    const storeDocs = storeIds.length > 0
      ? await storesCollection.find({ id: { $in: storeIds } }).toArray()
      : [];
    const storeMap = new Map(
      storeDocs.map((store) => [store?.id, store?.name || null])
    );

    result.offers = filtered.map((offer) => ({
      offerId: String(offer?.id || offer?._id || ''),
      storeId: offer?.storeId || null,
      storeName: storeMap.get(offer?.storeId) || null,
      source: offer?.source || null,
      price: offer.normalizedPrice,
      currency: offer?.currency || null,
      availability: offer?.availability || null,
      variantId: offer?.variantId || null,
      sku: offer?.sku ?? null,
      lastSyncedAt: toIsoString(offer?.lastSyncedAt)
    }));

    result.totalOffers = result.offers.length;
    return result;
  } catch (error) {
    logger.error({
      message: 'Offer aggregation failed',
      service: 'offer-aggregation',
      canonicalProductId: canonicalProductId || null,
      error: error?.message || String(error)
    });
    return result;
  }
}

async function getOfferSummary(canonicalProductId) {
  const emptySummary = {
    canonicalProductId: canonicalProductId || null,
    lowestPrice: null,
    highestPrice: null,
    currency: null,
    availableAt: [],
    totalOffers: 0,
    inStockCount: 0,
    offers: []
  };

  try {
    const aggregated = await aggregateOffers(canonicalProductId);
    const offers = Array.isArray(aggregated?.offers) ? aggregated.offers : [];
    if (offers.length === 0) {
      return { ...emptySummary, offers };
    }

    const prices = offers.map((offer) => offer.price).filter(Number.isFinite);
    const lowestPrice = prices.length > 0 ? Math.min(...prices) : null;
    const highestPrice = prices.length > 0 ? Math.max(...prices) : null;
    const currency = getMostCommonCurrency(offers);

    const availableAtSet = new Set();
    let inStockCount = 0;
    for (const offer of offers) {
      if (isInStockStatus(offer?.availability)) {
        inStockCount += 1;
        if (offer?.storeId) {
          availableAtSet.add(offer.storeId);
        }
      }
    }

    return {
      canonicalProductId: aggregated?.canonicalProductId || canonicalProductId || null,
      lowestPrice,
      highestPrice,
      currency,
      availableAt: Array.from(availableAtSet),
      totalOffers: offers.length,
      inStockCount,
      offers
    };
  } catch (error) {
    logger.error({
      message: 'Offer summary failed',
      service: 'offer-aggregation',
      canonicalProductId: canonicalProductId || null,
      error: error?.message || String(error)
    });
    return emptySummary;
  }
}

async function getBulkOfferSummaries(canonicalProductIds) {
  if (!Array.isArray(canonicalProductIds) || canonicalProductIds.length === 0) {
    return { results: [], failed: [] };
  }

  const tasks = canonicalProductIds.map(async (canonicalId) => {
    try {
      const summary = await getOfferSummary(canonicalId);
      return { canonicalId, summary, error: null };
    } catch (error) {
      return { canonicalId, summary: null, error };
    }
  });

  const settled = await Promise.all(tasks);
  const results = [];
  const failed = [];

  for (const item of settled) {
    if (item.error) {
      failed.push(item.canonicalId);
      logger.error({
        message: 'Bulk offer summary failed',
        service: 'offer-aggregation',
        canonicalProductId: item.canonicalId || null,
        error: item.error?.message || String(item.error)
      });
      continue;
    }

    if (item.summary) {
      results.push(item.summary);
    }
  }

  return { results, failed };
}

async function syncCanonicalPriceRange(canonicalProductId) {
  const emptyRange = { min: null, max: null, currency: null };

  try {
    if (!canonicalProductId) {
      return emptyRange;
    }

    const aggregated = await aggregateOffers(canonicalProductId);
    const offers = Array.isArray(aggregated?.offers) ? aggregated.offers : [];

    const prices = offers.map((offer) => offer.price).filter(Number.isFinite);
    const min = prices.length > 0 ? Math.min(...prices) : null;
    const max = prices.length > 0 ? Math.max(...prices) : null;
    const currency = getMostCommonCurrency(offers);

    await connectDB();
    const canonicalCollection = mongoose.connection.collection('canonical_products');

    await canonicalCollection.updateOne(
      { canonicalId: canonicalProductId },
      {
        $set: {
          priceRange: { min, max, currency },
          updatedAt: new Date()
        }
      }
    );

    logger.info({
      message: 'Canonical price range synced',
      service: 'offer-aggregation',
      canonicalProductId,
      priceRange: { min, max, currency }
    });

    return { min, max, currency };
  } catch (error) {
    logger.error({
      message: 'Canonical price range sync failed',
      service: 'offer-aggregation',
      canonicalProductId: canonicalProductId || null,
      error: error?.message || String(error)
    });
    return emptyRange;
  }
}

async function runFullOfferAggregation(options = {}) {
  const startTime = Date.now();
  const syncPriceRanges = options?.syncPriceRanges !== false;
  const batchSize = Number.isFinite(options?.batchSize) ? options.batchSize : 50;

  const summary = {
    totalCanonicalProducts: 0,
    totalOffers: 0,
    productsWithMultipleOffers: 0,
    averageOffersPerProduct: 0,
    duration: 0
  };

  try {
    await backfillOfferCanonicalIds({ batchSize, dryRun: false });
    await connectDB();

    const offersCollection = mongoose.connection.collection('offers');
    const canonicalIds = await offersCollection.distinct('canonicalProductId', {
      canonicalProductId: { $exists: true, $ne: null }
    });

    const chunks = [];
    for (let i = 0; i < canonicalIds.length; i += batchSize) {
      chunks.push(canonicalIds.slice(i, i + batchSize));
    }

    for (const chunk of chunks) {
      const tasks = chunk.map(async (canonicalId) => {
        try {
          const offerSummary = await getOfferSummary(canonicalId);
          if (syncPriceRanges) {
            await syncCanonicalPriceRange(canonicalId);
          }

          logger.info({
            message: 'Offer summary aggregated',
            service: 'offer-aggregation',
            canonicalProductId: canonicalId,
            totalOffers: offerSummary?.totalOffers || 0,
            lowestPrice: offerSummary?.lowestPrice ?? null,
            highestPrice: offerSummary?.highestPrice ?? null,
            inStockCount: offerSummary?.inStockCount || 0
          });

          return offerSummary;
        } catch (error) {
          logger.error({
            message: 'Offer aggregation failed for canonical product',
            service: 'offer-aggregation',
            canonicalProductId: canonicalId || null,
            error: error?.message || String(error)
          });
          return null;
        }
      });

      const chunkResults = await Promise.all(tasks);
      for (const offerSummary of chunkResults) {
        if (!offerSummary) {
          continue;
        }

        summary.totalCanonicalProducts += 1;
        summary.totalOffers += offerSummary.totalOffers || 0;
        if ((offerSummary.totalOffers || 0) > 1) {
          summary.productsWithMultipleOffers += 1;
        }
      }
    }

    summary.averageOffersPerProduct = summary.totalCanonicalProducts > 0
      ? Number((summary.totalOffers / summary.totalCanonicalProducts).toFixed(2))
      : 0;
  } catch (error) {
    logger.error({
      message: 'Full offer aggregation run failed',
      service: 'offer-aggregation',
      error: error?.message || String(error)
    });
  }

  summary.duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
  return summary;
}

module.exports = {
  backfillOfferCanonicalIds,
  aggregateOffers,
  getOfferSummary,
  getBulkOfferSummaries,
  syncCanonicalPriceRange,
  runFullOfferAggregation
};
