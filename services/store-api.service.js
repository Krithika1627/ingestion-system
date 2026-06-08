const mongoose = require('mongoose');
const { connectDB } = require('./db.service');

function buildCatalogSortObject(sort) {
  switch (sort) {
    case 'price_asc':
      return { 'priceRange.min': 1 };
    case 'price_desc':
      return { 'priceRange.min': -1 };
    case 'updated_at':
    default:
      return { updatedAt: -1 };
  }
}

async function getStores({ page = 1, limit = 20 } = {}) {
  await connectDB();

  const storesCollection = mongoose.connection.collection('stores');

  const skip = (page - 1) * limit;
  const total = await storesCollection.countDocuments();

  const docs = await storesCollection
    .find({})
    .sort({ name: 1 })
    .skip(skip)
    .limit(limit)
    .toArray();

  const productsCollection = mongoose.connection.collection('products');

  const data = await Promise.all(
    docs.map(async (doc) => {
      const storeId = doc.id;
      const productCount = (
        await productsCollection.distinct(
          'canonicalProductId',
          { storeId }
        )
      ).length;
      console.log({
  storeId,
  productCount
});
      return buildStoreResponse(doc, productCount);
    })
  );

  return {
    data,
    total,
    page,
    limit,
    hasMore: skip + limit < total
  };
}

async function getStoreById(storeId) {
  await connectDB();

  const storesCollection = mongoose.connection.collection('stores');
  const canonicalCollection = mongoose.connection.collection('canonical_products');

  const doc = await storesCollection.findOne({ id: storeId });

  if (!doc) return null;

  const productsCollection = mongoose.connection.collection('products');
  const productCount = (
    await productsCollection.distinct(
      'canonicalProductId',
      { storeId }
    )
  ).length;

  return buildStoreResponse(doc, productCount);
}

async function getStoreCatalog(storeId, { page = 1, limit = 20, sort = 'updated_at' } = {}) {
  await connectDB();

  const collection = mongoose.connection.collection('canonical_products');
  const sortObj = buildCatalogSortObject(sort);

  const productsCollection = mongoose.connection.collection('products');

  const canonicalIds = await productsCollection.distinct(
    'canonicalProductId',
    { storeId }
  );

  const filter = {
    canonicalId: { $in: canonicalIds }
  };

  const skip = (page - 1) * limit;
  const total = await collection.countDocuments(filter);

  const docs = await collection
    .find(filter)
    .sort(sortObj)
    .skip(skip)
    .limit(limit)
    .toArray();

  const data = docs.map(buildCatalogProductResponse);

  return {
    data,
    total,
    page,
    limit,
    hasMore: skip + limit < total
  };
}

function buildStoreResponse(doc, productCount) {
  if (!doc) return null;

  /* eslint-disable-next-line no-unused-vars */
  const { __v, _id, credentials, ...rest } = doc;

  return {
    ...rest,
    storeId: doc.id || null,
    lastSyncStatus: doc.lastSyncStatus || null,
    productCount: typeof productCount === 'number' ? productCount : 0
  };
}

function buildCatalogProductResponse(doc) {
  if (!doc) return null;

  let firstImage = null;
  if (Array.isArray(doc.images) && doc.images.length > 0) {
    firstImage = doc.images[0];
  }

  return {
    canonicalProductId: doc.canonicalId || null,
    title: doc.title || null,
    brand: doc.brand || null,
    category: doc.category || null,
    priceRange: doc.priceRange || null,
    image: firstImage
  };
}

module.exports = {
  getStores,
  getStoreById,
  getStoreCatalog,
  buildStoreResponse
};
