const logger = require('./logger.service');

function buildPriceContext(offers, priceRange) {
  if (!Array.isArray(offers) || offers.length === 0) {
    if (typeof priceRange?.min === 'number') {
      return `Listed from ${priceRange.currency || 'USD'} ${priceRange.min}`;
    }

  return 'Price information unavailable';
}

  const inStockOffers = offers.filter(
    (o) => o.availability === 'in_stock' || o.availability === 'limited'
  );

  if (inStockOffers.length === 0) {
    return 'Currently out of stock across all stores';
  }

  if (inStockOffers.length === 1) {
    const o = inStockOffers[0];
    const storeName = o.storeName || 'Unknown Store';
    const currency = o.currency || 'USD';
    const price = o.price != null ? o.price : 0;
    return `Available at ${storeName} for ${currency} ${price}`;
  }

  const sorted = [...inStockOffers].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  const cheapest = sorted[0];
  const others = sorted.slice(1);

  const cheapestName = cheapest.storeName || 'Unknown Store';
  const currency = cheapest.currency || 'USD';
  const cheapestPrice = cheapest.price != null ? cheapest.price : 0;
  const otherNames = others.map((o) => o.storeName || 'Unknown Store');

  return `Cheapest at ${cheapestName} for ${currency} ${cheapestPrice}, also available at ${otherNames.join(', ')}`;
}

function buildSummary(canonicalDoc) {
  if (!canonicalDoc) return 'Unknown Product';

  const title = canonicalDoc.title || '';
  const brand = canonicalDoc.brand || '';
  const category = canonicalDoc.category || '';

  const name = (
    brand &&
    title.toLowerCase().startsWith(brand.toLowerCase())
  )
    ? title
    : `${brand} ${title}`.trim();

  if (category) {
    return `${name} - ${category}`;
  }

  return name || 'Unknown Product';
}

function formatProductForAI(canonicalDoc, offers) {
  if (!canonicalDoc) return null;

  const priceRange = canonicalDoc.priceRange || {};
  const offersList = Array.isArray(offers) ? offers : [];

  const inStockOffers = offersList.filter(
    (o) => o.availability === 'in_stock' || o.availability === 'limited'
  );

  let platforms = [];
  if (offersList.length > 0) {
    platforms = [...new Set(offersList.map((o) => o.platform).filter(Boolean))];
  } else if (Array.isArray(canonicalDoc.sources)) {
    platforms = [
      ...new Set(
        canonicalDoc.sources.map((s) =>
          typeof s === 'string' ? s : s.source || s.platform || ''
        ).filter(Boolean)
      )
    ];
  }
  const lowestPrice = typeof priceRange.min === 'number' ? priceRange.min : 0;

  const formatted = {
    id: canonicalDoc.canonicalProductId || canonicalDoc.canonicalId || '',
    name: canonicalDoc.title || '',
    brand: canonicalDoc.brand || '',
    category: canonicalDoc.category || 'Uncategorized',
    description: canonicalDoc.description || '',
    images: Array.isArray(canonicalDoc.images) ? canonicalDoc.images.map((img) => img?.url).filter(Boolean) : [],
    attributes: canonicalDoc.attributes || {},

    lowestPrice: typeof priceRange.min === 'number' ? priceRange.min : 0,
    highestPrice: typeof priceRange.max === 'number' ? priceRange.max : 0,
    currency: priceRange.currency || 'USD',
    hasVariablePricing: priceRange.min !== priceRange.max,

    totalStores: offersList.length,
    inStockStores: inStockOffers.length,
    isAvailable: offersList.length > 0 ? inStockOffers.length > 0 : lowestPrice > 0,

    priceContext: buildPriceContext(offersList, priceRange),
    summary: buildSummary(canonicalDoc),

    platforms,
    storeCount: offersList.length,

    lastUpdated: canonicalDoc.updatedAt
      ? new Date(canonicalDoc.updatedAt).toISOString()
      : ''
  };

  return formatted;
}

function validateAIResponse(obj, endpoint) {
  const warnings = [];

  if (!obj || typeof obj !== 'object') {
    logger.warn('AI response validation warning', {
      endpoint,
      field: 'root',
      issue: 'response object is null or undefined',
      canonicalProductId: null
    });
    return { valid: false, warnings: ['response object is null or undefined'] };
  }

  const requiredFields = [
    'id',
    'name',
    'brand',
    'category',
    'description',
    'lowestPrice',
    'highestPrice',
    'currency',
    'isAvailable',
    'summary',
    'priceContext',
    'platforms',
    'lastUpdated'
  ];

  for (const field of requiredFields) {
    if (obj[field] === undefined) {
      warnings.push(`field '${field}' is undefined`);
      logger.warn('AI response validation warning', {
        endpoint,
        field,
        issue: 'value is undefined',
        canonicalProductId: obj.id
      });
    } else if (obj[field] === null) {
      warnings.push(`field '${field}' is null`);
      logger.warn('AI response validation warning', {
        endpoint,
        field,
        issue: 'value is null',
        canonicalProductId: obj.id
      });
    }
  }

  if (obj.lowestPrice !== undefined && typeof obj.lowestPrice !== 'number') {
    warnings.push("field 'lowestPrice' is not a number");
    logger.warn('AI response validation warning', {
      endpoint,
      field: 'lowestPrice',
      issue: 'not a number',
      canonicalProductId: obj.id
    });
  }

  if (obj.highestPrice !== undefined && typeof obj.highestPrice !== 'number') {
    warnings.push("field 'highestPrice' is not a number");
    logger.warn('AI response validation warning', {
      endpoint,
      field: 'highestPrice',
      issue: 'not a number',
      canonicalProductId: obj.id
    });
  }

  if (obj.isAvailable !== undefined && typeof obj.isAvailable !== 'boolean') {
    warnings.push("field 'isAvailable' is not a boolean");
    logger.warn('AI response validation warning', {
      endpoint,
      field: 'isAvailable',
      issue: 'not a boolean',
      canonicalProductId: obj.id
    });
  }

  if (obj.totalStores !== undefined && typeof obj.totalStores !== 'number') {
    warnings.push("field 'totalStores' is not a number");
    logger.warn('AI response validation warning', {
      endpoint,
      field: 'totalStores',
      issue: 'not a number',
      canonicalProductId: obj.id
    });
  }

  if (obj.inStockStores !== undefined && typeof obj.inStockStores !== 'number') {
    warnings.push("field 'inStockStores' is not a number");
    logger.warn('AI response validation warning', {
      endpoint,
      field: 'inStockStores',
      issue: 'not a number',
      canonicalProductId: obj.id
    });
  }

  if (obj.platforms !== undefined && !Array.isArray(obj.platforms)) {
    warnings.push("field 'platforms' is not an array");
    logger.warn('AI response validation warning', {
      endpoint,
      field: 'platforms',
      issue: 'not an array',
      canonicalProductId: obj.id
    });
  }

  return { valid: warnings.length === 0, warnings };
}

function formatCatalogItem(canonicalDoc) {
  if (!canonicalDoc) return null;

  const priceRange = canonicalDoc.priceRange || {};

  let platforms = [];
  if (Array.isArray(canonicalDoc.sources)) {
    platforms = [
      ...new Set(
        canonicalDoc.sources
          .map((s) => (typeof s === 'string' ? s : s.source || s.platform || ''))
          .filter(Boolean)
      )
    ];
  }

  return {
    id: canonicalDoc.canonicalId || '',
    name: canonicalDoc.title || '',
    brand: canonicalDoc.brand || '',
    category: canonicalDoc.category || 'Uncategorized',
    summary: buildSummary(canonicalDoc),
    lowestPrice: typeof priceRange.min === 'number' ? priceRange.min : 0,
    currency: priceRange.currency || 'USD',
    isAvailable: !!canonicalDoc.priceRange,
    platforms,
    lastUpdated: canonicalDoc.updatedAt
      ? new Date(canonicalDoc.updatedAt).toISOString()
      : ''
  };
}

function buildSearchContext(q, results, total) {
  if (!total || total === 0) {
    return `No products found matching '${q}'.`;
  }

  const platforms = new Set();
  let lowestPrice = Infinity;
  let highestPrice = -Infinity;
  let currency = 'USD';

  const items = Array.isArray(results) ? results : [];

  for (const r of items) {
    if (Array.isArray(r.platforms)) {
      r.platforms.forEach((p) => platforms.add(p));
    }
    if (typeof r.lowestPrice === 'number' && r.lowestPrice < lowestPrice) {
      lowestPrice = r.lowestPrice;
      currency = r.currency || currency;
    }
    if (typeof r.highestPrice === 'number' && r.highestPrice > highestPrice) {
      highestPrice = r.highestPrice;
    }
  }

  if (lowestPrice === Infinity) lowestPrice = 0;
  if (highestPrice === -Infinity) highestPrice = 0;

  const platformStr = platforms.size > 0 ? [...platforms].join(', ') : 'N/A';

  return `Found ${total} products matching '${q}'. Price range: ${currency} ${lowestPrice} to ${currency} ${highestPrice}. Available on: ${platformStr}.`;
}

module.exports = {
  formatProductForAI,
  buildPriceContext,
  buildSummary,
  validateAIResponse,
  formatCatalogItem,
  buildSearchContext
};
