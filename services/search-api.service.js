const mongoose = require('mongoose');
const logger = require('./logger.service');
const { connectDB } = require('./db.service');
const { buildProductResponse } = require('./product-api.service');

function escapeRegex(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSortObject(sort) {
  switch (sort) {
    case 'price_asc':
      return { 'priceRange.min': 1 };
    case 'price_desc':
      return { 'priceRange.max': -1 };
    case 'updated_at':
      return { updatedAt: -1 };
    case 'relevance':
    default:
      return { score: { $meta: 'textScore' } };
  }
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
        message: 'Text index ensured on canonical_products',
        service: 'search-api'
      });
    } else {
      logger.info({
        message: 'Text index already exists on canonical_products',
        service: 'search-api'
      });
    }
  } catch (error) {
    logger.warn({
      message: 'Failed to ensure text index on canonical_products',
      service: 'search-api',
      error: error?.message || String(error)
    });
  }
}

function buildSearchResult(doc) {
  if (!doc) return null;

  const result = buildProductResponse(doc);

  if (doc.score !== undefined && doc.score !== null) {
    result.score = Math.round(doc.score * 100) / 100;
  }

  return result;
}

async function searchProducts({ q, filters = {}, sort = 'relevance', page = 1, limit = 20 } = {}) {
  const startTime = Date.now();

  if (!q || typeof q !== 'string' || q.trim().length < 1) {
    return {
      data: [],
      total: 0,
      page,
      limit,
      hasMore: false,
      query: q || ''
    };
  }

  await connectDB();

  const collection = mongoose.connection.collection('canonical_products');

  const filter = { $text: { $search: q } };

  if (filters.category) {
    filter.category = filters.category;
  }

  if (filters.brand) {
    filter.brand = { $regex: escapeRegex(filters.brand), $options: 'i' };
  }

  if (filters.platform) {
    filter.sources = filters.platform;
  }

  if (filters.min_price !== undefined && filters.min_price !== null) {
    filter['priceRange.min'] = { $gte: filters.min_price };
  }

  if (filters.max_price !== undefined && filters.max_price !== null) {
    filter['priceRange.max'] = { $lte: filters.max_price };
  }

  if (filters.availability) {
    const canonicalIds = await getCanonicalIdsByAvailability(filters.availability);
    filter.canonicalId = { $in: canonicalIds };
  }

  const projection = { score: { $meta: 'textScore' } };

  const sortObj = buildSortObject(sort);

  const skip = (page - 1) * limit;
  const total = await collection.countDocuments(filter);

  const docs = await collection
    .find(filter)
    .project(projection)
    .sort(sortObj)
    .skip(skip)
    .limit(limit)
    .toArray();

  const data = docs.map(buildSearchResult);
  const responseTime = Date.now() - startTime;

  logger.info({
    message: 'Search executed',
    service: 'search-api',
    query: q,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
    resultCount: data.length,
    total,
    responseTimeMs: responseTime,
    sort
  });

  return {
    data,
    total,
    page,
    limit,
    hasMore: skip + limit < total,
    query: q
  };
}

async function getSuggestions(q) {
  if (!q || typeof q !== 'string' || q.trim().length < 2) {
    return {
      query: q || '',
      suggestions: []
    };
  }

  await connectDB();

  const collection = mongoose.connection.collection('canonical_products');
  const escaped = escapeRegex(q);

  const docs = await collection
    .find({
      $or: [
        { title: { $regex: escaped, $options: 'i' } },
        { brand: { $regex: escaped, $options: 'i' } }
      ]
    })
    .project({ canonicalId: 1, title: 1, brand: 1, category: 1 })
    .limit(8)
    .toArray();

  const suggestions = docs.map((doc) => ({
    canonicalProductId: doc.canonicalId || null,
    title: doc.title || null,
    brand: doc.brand || null,
    category: doc.category || null
  }));

  return {
    query: q,
    suggestions
  };
}

module.exports = {
  ensureTextIndex,
  searchProducts,
  getSuggestions,
  buildSearchResult
};
