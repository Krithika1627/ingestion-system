const mongoose = require('mongoose');
const logger = require('./logger.service');
const { connectDB, getStoreById } = require('./db.service');

function escapeRegex(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

async function buildFilter(filters) {
  const filter = {};

  /* Direct field filters */
  if (filters.category) {
    filter.category = filters.category;
  }

  if (filters.brand) {
    filter.brand = { $regex: new RegExp(`^${escapeRegex(filters.brand)}$`, 'i') };
  }

  if (filters.platform) {
    filter.$or = [
      { sources: filters.platform },
      { 'sources.source': filters.platform }
    ];
  }

  if (filters.storeId) {
    filter['sources.storeId'] = filters.storeId;
  }

  return { filter, availabilityFilter: filters.availability || null };
}

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

  return ids.length > 0 ? ids : [null];
}

async function getProducts({ page = 1, limit = 20, sort = 'updated_at', filters = {} } = {}) {
  await connectDB();

  const collection = mongoose.connection.collection('canonical_products');
  const sortObj = buildSortObject(sort);
  const { filter, availabilityFilter } = await buildFilter(filters);

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

async function getProductById(canonicalProductId) {
  await connectDB();

  const collection = mongoose.connection.collection('canonical_products');
  const doc = await collection.findOne({ canonicalId: canonicalProductId });

  if (!doc) return null;

  return buildProductResponse(doc);
}

async function getProductSources(canonicalProductId) {
  await connectDB();

  const canonicalCollection = mongoose.connection.collection('canonical_products');
  const canonicalDoc = await canonicalCollection.findOne({ canonicalId: canonicalProductId });

  if (!canonicalDoc) {
    return null;
  }

  const productsCollection = mongoose.connection.collection('products');

  const rawSources = Array.isArray(canonicalDoc.sources) ? canonicalDoc.sources : [];

  const resolvedSources = [];

  for (const entry of rawSources) {
    let storeId, platform, sourceId;

    if (typeof entry === 'string') {
      platform = entry;
      storeId = null;
      sourceId = null;
    } else if (typeof entry === 'object' && entry !== null) {
      platform = entry.source || entry.platform || null;
      storeId = entry.storeId || null;
      sourceId = entry.sourceId || null;
    }

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

function buildProductResponse(doc) {
  if (!doc) return null;

  /* Destructure to omit __v */
  /* eslint-disable-next-line no-unused-vars */
  const { __v, _id, canonicalId, ...rest } = doc;

  const response = {
    ...rest,
    canonicalProductId: canonicalId || null
  };

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
