/**
 * Product API service — data access layer for the canonical product API.
 *
 * Keeps all DB queries out of route handlers.
 * Exposes paginated listing, single-product lookup, source resolution,
 * and a consistent response builder.
 */
const mongoose = require('mongoose');
const logger = require('./logger.service');
const { connectDB, getStoreById } = require('./db.service');

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Escape special regex characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the MongoDB sort object from the API sort token.
 * @param {string} sort
 * @returns {object}
 */
function buildSortObject(sort) {
  switch (sort) {
    case 'price_asc':
      return { 'priceRange.min': 1 };
    case 'price_desc':
      return { 'priceRange.min': -1 };
    case 'relevance':
      return { score: { $meta: 'textScore' } };
    case 'updated_at':
    default:
      return { updatedAt: -1 };
  }
}

/**
 * Build the MongoDB filter object from the incoming API filters.
 *
 * Supports:
 *  - category, brand  → direct field match
 *  - platform         → match against sources array (string or object elements)
 *  - storeId          → match against sources[].storeId
 *  - availability     → joined check via offers collection (handled in getProducts)
 *
 * @param {object} filters
 * @returns {Promise<{filter:object, availabilityFilter:string|null}>}
 */
async function buildFilter(filters) {
  const filter = {};

  /* Direct field filters */
  if (filters.category) {
    filter.category = filters.category;
  }

  if (filters.brand) {
    filter.brand = { $regex: new RegExp(`^${escapeRegex(filters.brand)}$`, 'i') };
  }

  /* Platform filter — sources array can be strings or { source, sourceId, storeId } objects.
   * Use $or so either format matches. */
  if (filters.platform) {
    filter.$or = [
      { sources: filters.platform },
      { 'sources.source': filters.platform }
    ];
  }

  /*
   * StoreId filter.
   * If platform filter already set an $or, keep storeId as a top-level
   * AND condition (not inside $or) so both constraints apply together.
   */
  if (filters.storeId) {
    filter['sources.storeId'] = filters.storeId;
  }

  return { filter, availabilityFilter: filters.availability || null };
}

/**
 * Get an array of canonicalProductIds filtered by offer availability.
 * @param {string} availabilityFilter — 'inStock' | 'outOfStock'
 * @returns {Promise<string[]>}
 */
async function getCanonicalIdsByAvailability(availabilityFilter) {
  if (!availabilityFilter) return null;

  const offersCollection = mongoose.connection.collection('offers');
  const isInStock = availabilityFilter === 'inStock';

  const pipeline = [
    { $match: { isInStock } },
    { $group: { _id: '$canonicalProductId', count: { $sum: 1 } } },
    { $match: { _id: { $ne: null } } },
    { $project: { _id: 1 } }
  ];

  const results = await offersCollection.aggregate(pipeline).toArray();
  const ids = results.map((r) => r._id).filter(Boolean);

  /* Force no results when no matching IDs found */
  return ids.length > 0 ? ids : [null];
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Paginated list of canonical products with filtering and sorting.
 *
 * @param {object} options
 * @param {number}  [options.page=1]
 * @param {number}  [options.limit=20]
 * @param {string}  [options.sort='updated_at']
 * @param {object}  [options.filters={}]
 * @returns {Promise<{data:object[], total:number, page:number, limit:number, hasMore:boolean}>}
 */
async function getProducts({ page = 1, limit = 20, sort = 'updated_at', filters = {} } = {}) {
  await connectDB();

  const collection = mongoose.connection.collection('canonical_products');
  const sortObj = buildSortObject(sort);
  const { filter, availabilityFilter } = await buildFilter(filters);

  /* Handle availability filter via offers join */
  if (availabilityFilter) {
    const canonicalIds = await getCanonicalIdsByAvailability(availabilityFilter);
    filter.canonicalId = { $in: canonicalIds };
  }

  const skip = (page - 1) * limit;
  const total = await collection.countDocuments(filter);

  const docs = await collection
    .find(filter)
    .sort(sortObj)
    .skip(skip)
    .limit(limit)
    .toArray();

  const data = docs.map(buildProductResponse);

  return {
    data,
    total,
    page,
    limit,
    hasMore: skip + limit < total
  };
}

/**
 * Get a single canonical product by its canonicalProductId (cprod_xxx).
 *
 * @param {string} canonicalProductId
 * @returns {Promise<object|null>}
 */
async function getProductById(canonicalProductId) {
  await connectDB();

  const collection = mongoose.connection.collection('canonical_products');
  const doc = await collection.findOne({ canonicalId: canonicalProductId });

  if (!doc) return null;

  return buildProductResponse(doc);
}

/**
 * Resolve the raw source records for a canonical product.
 *
 * Looks up the canonical document, then for each source finds the
 * raw product record from the `products` collection.
 *
 * @param {string} canonicalProductId
 * @returns {Promise<{canonicalProductId:string, sourceCount:number, sources:object[]}|null>}
 */
async function getProductSources(canonicalProductId) {
  await connectDB();

  const canonicalCollection = mongoose.connection.collection('canonical_products');
  const canonicalDoc = await canonicalCollection.findOne({ canonicalId: canonicalProductId });

  if (!canonicalDoc) {
    return null;
  }

  const productsCollection = mongoose.connection.collection('products');

  /* Evaluate sources array (could be strings or objects) */
  const rawSources = Array.isArray(canonicalDoc.sources) ? canonicalDoc.sources : [];

  const resolvedSources = [];

  for (const entry of rawSources) {
    let storeId, platform, sourceId;

    if (typeof entry === 'string') {
      /* Legacy format: sources is just ['shopify', 'magento'] */
      platform = entry;
      storeId = null;
      sourceId = null;
    } else if (typeof entry === 'object' && entry !== null) {
      /* Enriched format: { source, sourceId, storeId } */
      platform = entry.source || entry.platform || null;
      storeId = entry.storeId || null;
      sourceId = entry.sourceId || null;
    }

    /* Build query for the products collection */
    const productQuery = { canonicalProductId };
    if (storeId) {
      productQuery.storeId = storeId;
    }

    const productDoc = await productsCollection.findOne(productQuery, {
      projection: {
        sourceId: 1,
        storeId: 1,
        source: 1,
        title: 1,
        lastSyncedAt: 1,
        variants: 1
      }
    });

    /* Resolve store name */
    let storeName = null;
    if (storeId) {
      const store = await getStoreById(storeId);
      storeName = store?.name || null;
    }

    resolvedSources.push({
      sourceId: productDoc?.sourceId || sourceId || null,
      storeId: storeId || productDoc?.storeId || null,
      storeName,
      platform: productDoc?.source || platform || null,
      title: productDoc?.title || null,
      price: productDoc?.variants?.[0]?.price ?? null,
      lastSyncedAt: productDoc?.lastSyncedAt || null
    });
  }

  return {
    canonicalProductId,
    sourceCount: resolvedSources.length,
    sources: resolvedSources
  };
}

/**
 * Build a consistent API response object from a canonical product document.
 *
 * - Strips __v
 * - Keeps _id as a string
 * - Also exposes canonicalProductId (aliases from canonicalId)
 * - Formats priceRange: null if both min and max are null
 *
 * @param {object} doc — raw MongoDB document from canonical_products
 * @returns {object|null}
 */
function buildProductResponse(doc) {
  if (!doc) return null;

  /* Destructure to omit __v */
  /* eslint-disable-next-line no-unused-vars */
  const { __v, _id, canonicalId, ...rest } = doc;

  const response = {
    ...rest,
    _id: _id != null ? String(_id) : null,
    canonicalProductId: canonicalId || null
  };

  /* Tidy priceRange */
  if (response.priceRange) {
    const { min, max, ...priceRest } = response.priceRange;
    if (min === null && max === null) {
      response.priceRange = null;
    } else {
      response.priceRange = { min, max, ...priceRest };
    }
  }

  return response;
}

/**
 * Ensure a MongoDB text index exists on canonical_products.
 * Safe to call on every startup — it's a no-op if the index already exists.
 *
 * Indexed fields: title, brand, description (for future text search).
 *
 * @returns {Promise<void>}
 */
async function ensureTextIndex() {
  try {
    await connectDB();
    const collection = mongoose.connection.collection('canonical_products');

    const existingIndexes = await collection.indexes();
    const hasTextIndex = existingIndexes.some(
      (idx) => idx.key && idx.key._fts === 'text'
    );

    if (!hasTextIndex) {
      await collection.createIndex(
        { title: 'text', brand: 'text', description: 'text' },
        {
          name: 'product_text_search',
          weights: { title: 10, brand: 5, description: 1 },
          background: true
        }
      );
      logger.info({
        message: 'Text index created on canonical_products',
        service: 'product-api'
      });
    } else {
      logger.info({
        message: 'Text index already exists on canonical_products',
        service: 'product-api'
      });
    }
  } catch (error) {
    logger.warn({
      message: 'Failed to ensure text index on canonical_products',
      service: 'product-api',
      error: error?.message || String(error)
    });
  }
}

module.exports = {
  getProducts,
  getProductById,
  getProductSources,
  buildProductResponse,
  ensureTextIndex
};
