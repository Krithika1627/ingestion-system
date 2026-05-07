/**
 * MongoDB service for connecting and upserting products, offers, and raw responses.
 */
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
    logger.info({ message: 'MongoDB connection established', service: 'db' });
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
    { sourceId: canonicalProduct.sourceId },
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

  if (!offerRecord?.sourceId || !offerRecord?.storeId) {
    throw new Error('upsertOffer requires offerRecord.sourceId and offerRecord.storeId');
  }

  const collection = getCollection('offers');
  await collection.updateOne(
    { sourceId: offerRecord.sourceId, storeId: offerRecord.storeId },
    { $set: offerRecord },
    { upsert: true }
  );

  return offerRecord;
}

module.exports = { connectDB, upsertProduct, upsertRaw, upsertOffer };
