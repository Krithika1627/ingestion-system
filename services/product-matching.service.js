const logger = require('./logger.service');
const {
  findProductBySku,
  findProductByGroupingKey
} = require('./db.service');

function normalizeGroupingValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '_');
}

function pickVariantSku(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  for (const variant of variants) {
    const sku = typeof variant?.sku === 'string' ? variant.sku.trim() : '';
    if (sku) {
      return sku;
    }
  }
  return null;
}

function buildGroupingKey(product) {
  const skuRaw = typeof product?.sku === 'string' ? product.sku.trim() : '';
  const sku = skuRaw || pickVariantSku(product) || '';
  const normalizedSku = normalizeGroupingValue(sku);

  if (normalizedSku) {
    return normalizedSku;
  }

  const brandRaw = typeof product?.normalizedBrand === 'string'
    ? product.normalizedBrand
    : product?.brand;
  const titleRaw = typeof product?.cleanedTitle === 'string'
    ? product.cleanedTitle
    : product?.title;

  const normalizedBrand = normalizeGroupingValue(brandRaw);
  const normalizedTitle = normalizeGroupingValue(titleRaw);

  if (!normalizedBrand || !normalizedTitle) {
    return null;
  }

  return `${normalizedBrand}_${normalizedTitle}`;
}

async function findExistingProductMatch(storeId, product) {
  if (!storeId) {
    logger.warn({
      message: 'Missing storeId for product match lookup',
      service: 'product-matching'
    });
    return { match: null, matchType: null };
  }

  const sku = typeof product?.sku === 'string' ? product.sku.trim() : null;
  if (sku) {
    const match = await findProductBySku(sku);
    if (match) {
      return { match, matchType: 'sku' };
    }
  }

  const groupingKey = product?.groupingKey || buildGroupingKey(product);
  if (groupingKey) {
    const match = await findProductByGroupingKey(groupingKey);
    if (match) {
      return { match, matchType: 'groupingKey' };
    }
  }

  return { match: null, matchType: null };
}

function mergeMatchedProduct(existing, incoming) {
  if (!existing) {
    return incoming;
  }

  const merged = { ...incoming };
  merged.id = existing?.id || incoming?.id;
  merged.sku = incoming?.sku || existing?.sku || null;
  merged.brand = incoming?.brand || existing?.brand || null;
  merged.normalizedBrand = incoming?.normalizedBrand || existing?.normalizedBrand || null;
  merged.cleanedTitle = incoming?.cleanedTitle || existing?.cleanedTitle || null;
  merged.groupingKey = incoming?.groupingKey || existing?.groupingKey || null;

  if (!Array.isArray(merged.categoryIds) || merged.categoryIds.length === 0) {
    merged.categoryIds = Array.isArray(existing?.categoryIds) ? existing.categoryIds : [];
  }

  return merged;
}

module.exports = {
  buildGroupingKey,
  findExistingProductMatch,
  mergeMatchedProduct
};
