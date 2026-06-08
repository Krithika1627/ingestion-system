const mongoose = require('mongoose');
const { connectDB } = require('./db.service');

async function enrichOfferWithStore(offer, storeCache) {
  const storeId = offer.storeId;
  let store = storeCache ? storeCache.get(storeId) : null;

  if (!store) {
    const storesCollection = mongoose.connection.collection('stores');
    store = await storesCollection.findOne({ id: storeId });
    if (storeCache && store) {
      storeCache.set(storeId, store);
    }
  }

  return {
    offerId: offer.id || null,
    canonicalProductId: offer.canonicalProductId || null,
    storeId: offer.storeId || null,
    storeName: store?.name || null,
    platform: store?.platform || offer.platform || null,
    variantId: offer.variantId || null,
    price: offer.price ?? null,
    currency: offer.currency || null,
    availability: offer.availability || null,
    updatedAt: offer.updatedAt || null
  };
}

async function enrichOfferWithProduct(offer, productCache) {
  const canonicalProductId = offer.canonicalProductId;
  let product = productCache ? productCache.get(canonicalProductId) : null;

  if (!product && canonicalProductId) {
    const canonicalCollection = mongoose.connection.collection('canonical_products');
    product = await canonicalCollection.findOne(
      { canonicalId: canonicalProductId },
      { projection: { title: 1, brand: 1 } }
    );
    if (productCache && product) {
      productCache.set(canonicalProductId, product);
    }
  }

  return {
    offerId: offer.id || null,
    canonicalProductId: canonicalProductId || null,
    productTitle: product?.title || null,
    productBrand: product?.brand || null,
    storeId: offer.storeId || null,
    variantId: offer.variantId || null,
    price: offer.price ?? null,
    currency: offer.currency || null,
    availability: offer.availability || null,
    updatedAt: offer.updatedAt || null
  };
}

async function getOffersByProduct(canonicalProductId) {
  await connectDB();

  const offersCollection = mongoose.connection.collection('offers');

  const docs = await offersCollection
    .find({ canonicalProductId })
    .sort({ price: 1 })
    .toArray();

  const storeCache = new Map();
  const offers = await Promise.all(
    docs.map((offer) => enrichOfferWithStore(offer, storeCache))
  );

  const prices = offers
    .map((o) => o.price)
    .filter((p) => p !== null && p !== undefined);

  const inStockOffers = offers.filter(
    (o) => o.availability === 'in_stock' || o.availability === 'limited'
  );

  const minPrice = prices.length > 0 ? Math.min(...prices) : null;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : null;

  /* Find the store names for lowest and highest prices */
  const lowestPriceOffer = minPrice !== null
    ? offers.find((o) => o.price === minPrice)
    : null;

  const highestPriceOffer = maxPrice !== null
    ? offers.find((o) => o.price === maxPrice)
    : null;

  const summary = {
    totalOffers: offers.length,
    lowestPrice: lowestPriceOffer
      ? { price: lowestPriceOffer.price, currency: lowestPriceOffer.currency, storeName: lowestPriceOffer.storeName }
      : null,
    highestPrice: highestPriceOffer
      ? { price: highestPriceOffer.price, currency: highestPriceOffer.currency, storeName: highestPriceOffer.storeName }
      : null,
    inStockCount: inStockOffers.length
  };

  return {
    canonicalProductId,
    summary,
    offers
  };
}

async function getOffersByStore(storeId, { page = 1, limit = 50 } = {}) {
  await connectDB();

  const offersCollection = mongoose.connection.collection('offers');

  const filter = { storeId };
  const skip = (page - 1) * limit;
  const total = await offersCollection.countDocuments(filter);

  const docs = await offersCollection
    .find(filter)
    .sort({
      updatedAt: -1,
      _id: 1
    })
    .skip(skip)
    .limit(limit)
    .toArray();

  const productCache = new Map();
  const data = await Promise.all(
    docs.map((offer) => enrichOfferWithProduct(offer, productCache))
  );

  return {
    data,
    total,
    page,
    limit,
    hasMore: skip + limit < total
  };
}

function validateOfferFilters({ product_id, store_id } = {}) {
  if (!product_id && !store_id) {
    return {
      valid: false,
      error: 'Provide product_id or store_id'
    };
  }

  if (product_id && typeof product_id === 'string' && !product_id.startsWith('cprod_')) {
    return {
      valid: false,
      error: 'Invalid param: product_id must start with cprod_'
    };
  }

  return { valid: true, error: null };
}

module.exports = {
  getOffersByProduct,
  getOffersByStore,
  validateOfferFilters
};
