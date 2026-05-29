/**
 * MongoDB service for connecting and upserting products, offers, and raw responses.
 */
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const logger = require('./logger.service');

let isConnected = false;

/**
 * Establish a MongoDB connection using the configured MONGO_URI.
 * @returns {Promise<void>}
 */
async function connectDB() {
  if (isConnected) {
    return;
  }

  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    const error = new Error('MONGO_URI is not configured');
    logger.error({ message: 'MongoDB connection failed', service: 'db', error: error.message });
    throw error;
  }

  try {
    await mongoose.connect(mongoUri);
    isConnected = true;

    logger.info({
      message: 'MongoDB connection established',
      service: 'db',
      uri: mongoUri.replace(/:\/\/([^@]+)@/, '://<redacted>@')
    });
  } catch (error) {
    logger.error({ message: 'MongoDB connection failed', service: 'db', error: error.message });
    throw error;
  }
}

function getCollection(name) {
  return mongoose.connection.collection(name);
}

/**
 * Upsert a canonical product into the products collection using sourceId.
 * @param {object} canonicalProduct
 * @returns {Promise<object>}
 */
async function upsertProduct(canonicalProduct) {
  await connectDB();

  if (!canonicalProduct?.sourceId) {
    throw new Error('upsertProduct requires canonicalProduct.sourceId');
  }

  const collection = getCollection('products');
  await collection.updateOne(
    {
      sourceId: canonicalProduct.sourceId,
      source: canonicalProduct.source,
      storeId: canonicalProduct.storeId
    },
    { $set: canonicalProduct },
    { upsert: true }
  );

  return canonicalProduct;
}

/**
 * Upsert a raw API response into the raw_responses collection.
 * @param {string} platform
 * @param {object} rawData
 * @returns {Promise<object>}
 */
async function upsertRaw(platform, rawData) {
  await connectDB();

  const collection = getCollection('raw_responses');
  const sourceId =
    rawData?.sourceId ||
    rawData?.id ||
    rawData?.node?.id ||
    rawData?.data?.id ||
    rawData?.data?.node?.id ||
    null;
  const filter = sourceId ? { platform, sourceId } : { _id: new mongoose.Types.ObjectId() };
  const payload = {
    platform,
    sourceId,
    storeId: rawData?.storeId || rawData?.data?.storeId || null,
    fetchedAt: new Date().toISOString(),
    data: rawData?.data || rawData
  };

  await collection.updateOne(filter, { $set: payload }, { upsert: true });

  return payload;
}

/**
 * Upsert an offer record into the offers collection using sourceId + storeId.
 * @param {object} offerRecord
 * @returns {Promise<object>}
 */
async function upsertOffer(offerRecord) {
  await connectDB();

  if (!offerRecord?.sourceId || !offerRecord?.storeId || !offerRecord?.variantId) {
    logger.warn({
      message: 'Skipping offer upsert due to missing keys',
      service: 'db',
      sourceId: offerRecord?.sourceId || null,
      storeId: offerRecord?.storeId || null,
      variantId: offerRecord?.variantId || null
    });
    return null;
  }

  const productsCollection = getCollection('products');
  const product = await productsCollection.findOne(
    { sourceId: offerRecord.sourceId, storeId: offerRecord.storeId },
    { projection: { id: 1 } }
  );

  const payload = {
    ...offerRecord,
    id: offerRecord?.id || randomUUID(),
    productId: product?.id || offerRecord?.productId || null
  };
  delete payload.title;

  if (!payload.productId) {
    logger.warn({
      message: 'Offer productId missing for sourceId',
      service: 'db',
      sourceId: offerRecord.sourceId,
      storeId: offerRecord.storeId
    });
  }

  const collection = getCollection('offers');
  await collection.updateOne(
    {
      sourceId: payload.sourceId,
      storeId: payload.storeId,
      variantId: payload.variantId
    },
    { $set: payload, $unset: { title: '' } },
    { upsert: true }
  );

  const legacyFilter = {
    sourceId: payload.sourceId,
    storeId: payload.storeId,
    $or: [{ variantId: { $exists: false } }, { variantId: null }]
  };
  const legacyResult = await collection.deleteMany(legacyFilter);
  if (legacyResult.deletedCount > 0) {
    logger.info({
      message: 'Removed legacy offers without variantId',
      service: 'db',
      sourceId: payload.sourceId,
      storeId: payload.storeId,
      deletedCount: legacyResult.deletedCount
    });
  }

  return payload;
}

/**
 * Get all categories for a store.
 * @param {string} storeId
 * @param {string} [source]
 * @returns {Promise<object[]>}
 */
async function getCategoriesByStore(storeId, source = 'shopify') {
  await connectDB();

  if (!storeId) {
    logger.warn({ message: 'Missing storeId for category fetch', service: 'db' });
    return [];
  }

  const collection = getCollection('categories');
  return collection.find({ storeId, source }).toArray();
}

/**
 * Get raw responses for a platform and store.
 * @param {string} platform
 * @param {string} storeId
 * @returns {Promise<object[]>}
 */
async function getRawResponsesByPlatform(platform, storeId) {
  await connectDB();

  if (!platform || !storeId) {
    logger.warn({
      message: 'Missing platform or storeId for raw response fetch',
      service: 'db',
      platform: platform || null,
      storeId: storeId || null
    });
    return [];
  }

  const collection = getCollection('raw_responses');
  return collection.find({ platform, storeId }).toArray();
}

/**
 * Get a raw response by platform and sourceId.
 * @param {string} platform
 * @param {string} sourceId
 * @param {string} [storeId]
 * @returns {Promise<object|null>}
 */
async function getRawResponseBySourceId(platform, sourceId, storeId) {
  await connectDB();

  if (!platform || !sourceId) {
    logger.warn({
      message: 'Missing platform or sourceId for raw response lookup',
      service: 'db',
      platform: platform || null,
      sourceId: sourceId || null
    });
    return null;
  }

  const collection = getCollection('raw_responses');
  const filter = storeId ? { platform, sourceId, storeId } : { platform, sourceId };
  return collection.findOne(filter);
}

/**
 * Add a categoryId to a product's categoryIds array (no duplicates).
 * @param {string} productSourceId
 * @param {string} categoryId
 * @param {string} [storeId]
 * @returns {Promise<boolean>}
 */
async function addCategoryIdToProduct(productSourceId, categoryId, storeId) {
  await connectDB();

  if (!productSourceId || !categoryId) {
    logger.warn({
      message: 'Missing keys for product category update',
      service: 'db',
      productSourceId: productSourceId || null,
      categoryId: categoryId || null
    });
    return false;
  }

  const collection = getCollection('products');
  const filter = storeId ? { sourceId: productSourceId, storeId } : { sourceId: productSourceId };
  const result = await collection.updateOne(
    filter,
    { $addToSet: { categoryIds: categoryId } }
  );

  if (result.matchedCount === 0) {
    logger.warn({
      message: 'Product not found for category update',
      service: 'db',
      productSourceId,
      categoryId,
      storeId: storeId || null
    });
    return false;
  }

  return true;
}

/**
 * Update lastSyncedAt on a store record.
 * @param {string} storeId
 * @returns {Promise<boolean>}
 */
async function updateStoreLastSynced(storeId) {
  await connectDB();

  if (!storeId) {
    logger.warn({ message: 'Missing storeId for store sync update', service: 'db' });
    return false;
  }

  const collection = getCollection('stores');
  const result = await collection.updateOne(
    { id: storeId },
    { $set: { lastSyncedAt: new Date().toISOString() } }
  );

  if (result.matchedCount === 0) {
    logger.warn({ message: 'Store not found for sync update', service: 'db', storeId });
    return false;
  }

  logger.info({ message: 'Store sync timestamp updated', service: 'db', storeId });
  return true;
}

/**
 * Get a store record by storeId.
 * @param {string} storeId
 * @returns {Promise<object|null>}
 */
async function getStoreById(storeId) {
  await connectDB();

  if (!storeId) {
    logger.warn({ message: 'Missing storeId for store fetch', service: 'db' });
    return null;
  }

  const collection = getCollection('stores');
  return collection.findOne({ id: storeId });
}

/**
 * Get a category by sourceId, storeId, and source.
 * @param {string} sourceId
 * @param {string} storeId
 * @param {string} source
 * @returns {Promise<object|null>}
 */
async function getCategoryBySourceId(sourceId, storeId, source) {
  await connectDB();

  if (!sourceId || !storeId || !source) {
    logger.warn({
      message: 'Missing keys for category lookup',
      service: 'db',
      sourceId: sourceId || null,
      storeId: storeId || null,
      source: source || null
    });
    return null;
  }

  const collection = getCollection('categories');
  return collection.findOne({ sourceId: String(sourceId), storeId, source });
}

/**
 * Get products by storeId and source.
 * @param {string} storeId
 * @param {string} source
 * @returns {Promise<object[]>}
 */
async function getProductsByStoreAndSource(storeId, source) {
  await connectDB();

  if (!storeId || !source) {
    logger.warn({
      message: 'Missing storeId or source for product fetch',
      service: 'db',
      storeId: storeId || null,
      source: source || null
    });
    return [];
  }

  const collection = getCollection('products');
  return collection.find({ storeId, source }).toArray();
}

/**
 * Find a product by storeId and SKU.
 * @param {string} storeId
 * @param {string} sku
 * @returns {Promise<object|null>}
 */
async function findProductBySku(storeId, sku) {
  await connectDB();

  const normalizedSku = typeof sku === 'string' ? sku.trim() : '';
  if (!storeId || !normalizedSku) {
    logger.warn({
      message: 'Missing storeId or sku for product lookup',
      service: 'db',
      storeId: storeId || null,
      sku: normalizedSku || null
    });
    return null;
  }

  const collection = getCollection('products');
  return collection.findOne({ sku: normalizedSku, storeId });
}

/**
 * Find a product by storeId and grouping key.
 * @param {string} storeId
 * @param {string} groupingKey
 * @returns {Promise<object|null>}
 */
async function findProductByGroupingKey(storeId, groupingKey) {
  await connectDB();

  const normalizedKey = typeof groupingKey === 'string' ? groupingKey.trim() : '';
  if (!storeId || !normalizedKey) {
    logger.warn({
      message: 'Missing storeId or groupingKey for product lookup',
      service: 'db',
      storeId: storeId || null,
      groupingKey: normalizedKey || null
    });
    return null;
  }

  const collection = getCollection('products');
  return collection.findOne({ groupingKey: normalizedKey, storeId });
}

/**
 * Replace a product's categoryIds with canonical UUIDs.
 * @param {string} productSourceId
 * @param {string} storeId
 * @param {string[]} categoryIds
 * @returns {Promise<boolean>}
 */
async function updateProductCategoryIds(productSourceId, storeId, categoryIds) {
  await connectDB();

  if (!productSourceId || !storeId) {
    logger.warn({
      message: 'Missing keys for product category update',
      service: 'db',
      productSourceId: productSourceId || null,
      storeId: storeId || null
    });
    return false;
  }

  const collection = getCollection('products');
  const result = await collection.updateOne(
    { sourceId: productSourceId, storeId },
    { $set: { categoryIds: categoryIds || [] } }
  );

  return result.matchedCount > 0;
}

/**
 * Update offers and product variants inventory by SKU.
 * @param {string} skuCode
 * @param {object} inventoryPatch
 * @returns {Promise<object>}
 */
async function updateOfferInventory(skuCode, inventoryPatch, storeId) {
  await connectDB();

  if (!skuCode) {
    logger.warn({ message: 'Missing skuCode for inventory update', service: 'db' });
    return { offersMatched: 0, offersModified: 0, productsMatched: 0 };
  }

  const patch = inventoryPatch || {};
  const resolvedStoreId = storeId || patch?.storeId || null;
  const fieldsToSet = Object.entries({
    availability: patch.availability,
    stockQty: patch.stockQty,
    isInStock: patch.isInStock,
    availableInventory: patch.availableInventory,
    totalInventory: patch.totalInventory,
    blockedInventory: patch.blockedInventory,
    facilityCode: patch.facilityCode,
    inventorySource: patch.inventorySource,
    lastSyncedAt: patch.lastSyncedAt
  }).reduce((acc, [key, value]) => {
    if (value !== undefined) {
      acc[key] = value;
    }
    return acc;
  }, {});

  const offersCollection = getCollection('offers');
  const offerFilter = resolvedStoreId ? { sku: skuCode, storeId: resolvedStoreId } : { sku: skuCode };
  const offerResult = await offersCollection.updateMany(
    offerFilter,
    { $set: fieldsToSet }
  );

  if (offerResult.matchedCount === 0) {
    logger.warn({
      message: 'No offers found for inventory update',
      service: 'db',
      skuCode
    });
  } else {
    logger.info({
      message: 'Offer inventory updated',
      service: 'db',
      skuCode,
      offersMatched: offerResult.matchedCount,
      offersModified: offerResult.modifiedCount
    });
  }

  const productsCollection = getCollection('products');
  const productFilter = resolvedStoreId
    ? { 'variants.sku': skuCode, storeId: resolvedStoreId }
    : { 'variants.sku': skuCode };
  const productResult = await productsCollection.updateMany(
    productFilter,
    {
      $set: {
        'variants.$[v].inventoryQty': patch.availableInventory,
        'variants.$[v].isInStock': patch.isInStock
      }
    },
    { arrayFilters: [{ 'v.sku': skuCode }] }
  );

  return {
    offersMatched: offerResult.matchedCount,
    offersModified: offerResult.modifiedCount,
    productsMatched: productResult.matchedCount
  };
}

/**
 * Upsert a canonical category into the categories collection using sourceId + storeId.
 * @param {object} canonicalCategory
 * @returns {Promise<object>}
 */
async function upsertCategory(canonicalCategory) {
  await connectDB();

  if (!canonicalCategory?.sourceId || !canonicalCategory?.storeId) {
    const error = new Error('upsertCategory requires canonicalCategory.sourceId and canonicalCategory.storeId');
    logger.error({
      message: 'Category upsert failed',
      service: 'db',
      sourceId: canonicalCategory?.sourceId || null,
      storeId: canonicalCategory?.storeId || null,
      error: error.message
    });
    throw error;
  }

  try {
    const collection = getCollection('categories');
    await collection.updateOne(
      {
        sourceId: canonicalCategory.sourceId,
        source: canonicalCategory.source,
        storeId: canonicalCategory.storeId
      },
      { $set: canonicalCategory },
      { upsert: true }
    );
    logger.info({
      message: 'Category upserted',
      service: 'db',
      sourceId: canonicalCategory.sourceId,
      storeId: canonicalCategory.storeId
    });
  } catch (error) {
    logger.error({
      message: 'Category upsert failed',
      service: 'db',
      sourceId: canonicalCategory?.sourceId || null,
      storeId: canonicalCategory?.storeId || null,
      error: error?.message || String(error)
    });
    throw error;
  }

  return canonicalCategory;
}

module.exports = {
  connectDB,
  upsertProduct,
  upsertRaw,
  upsertOffer,
  upsertCategory,
  getCategoriesByStore,
  getStoreById,
  getCategoryBySourceId,
  getProductsByStoreAndSource,
  findProductBySku,
  findProductByGroupingKey,
  updateProductCategoryIds,
  updateOfferInventory,
  getRawResponsesByPlatform,
  getRawResponseBySourceId,
  addCategoryIdToProduct,
  updateStoreLastSynced
};
