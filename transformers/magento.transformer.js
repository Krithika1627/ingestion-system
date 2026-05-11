/**
 * Transforms Magento product and category payloads into canonical formats.
 */
const { randomUUID } = require('crypto');

const ATTRIBUTE_SKIP_LIST = new Set([
  'description',
  'brand',
  'url_key',
  'category',
  'image',
  'small_image',
  'thumbnail'
]);

/**
 * Ensure the value is an array.
 * @param {any} value
 * @returns {Array}
 */
function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Convert a string to null when empty.
 * @param {any} value
 * @returns {string|null}
 */
function toNullableString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Clean title string by stripping HTML and trademark symbols.
 * @param {any} value
 * @returns {string|null}
 */
function cleanTitle(value) {
  if (typeof value !== 'string') {
    return null;
  }

  return value
    .replace(/<[^>]+>/g, '')
    .replace(/[®™©]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a date-time string to ISO 8601, or null if invalid.
 * @param {any} value
 * @returns {string|null}
 */
function normalizeDateTime(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

/**
 * Extract a custom attribute value from Magento custom_attributes array.
 * @param {Array} customAttributes
 * @param {string} code
 * @returns {string|null}
 */
function extractCustomAttribute(customAttributes, code) {
  const attributes = safeArray(customAttributes);
  const match = attributes.find((attr) => attr?.attribute_code === code);
  if (!match) {
    return null;
  }
  return toNullableString(match?.value);
}

/**
 * Transform Magento product item into canonical product.
 * @param {object} item
 * @param {string} storeId
 * @param {string} storeBaseUrl
 * @returns {object}
 */
function transformProduct(item, storeId, storeBaseUrl) {
  const sourceItem = item || {};
  const customAttributes = safeArray(sourceItem?.custom_attributes);
  const baseUrl = typeof storeBaseUrl === 'string' ? storeBaseUrl.replace(/\/$/, '') : '';
  const stockItem = sourceItem?.extension_attributes?.stock_item || null;
  const inventoryQty = typeof stockItem?.qty === 'number' ? stockItem.qty : null;
  const isInStock = Boolean(stockItem?.is_in_stock);
  const currency = process.env.MAGENTO_CURRENCY || 'INR';

  const images = safeArray(sourceItem?.media_gallery_entries)
    .filter((entry) => entry && entry.disabled !== true)
    .map((entry) => {
      const rawFile = entry?.file || '';
      const isAbsolute = typeof rawFile === 'string' && rawFile.startsWith('http');
      const url = isAbsolute
        ? rawFile
        : baseUrl
          ? `${baseUrl}/pub/media/catalog/product${rawFile}`
          : null;

      if (!url) {
        return null;
      }

      return {
        url,
        altText: toNullableString(entry?.label),
        position: typeof entry?.position === 'number' ? entry.position : null
      };
    })
    .filter(Boolean);

  const attributes = customAttributes.reduce((acc, attr) => {
    const code = attr?.attribute_code;
    if (!code || ATTRIBUTE_SKIP_LIST.has(code)) {
      return acc;
    }
    const value = toNullableString(attr?.value);
    if (value) {
      acc[code] = value;
    }
    return acc;
  }, {});

  const sku = toNullableString(sourceItem?.sku);
  const variantSku = sku || null;
  const variant = {
    variantId: variantSku,
    title: null,
    sku: variantSku,
    price: typeof sourceItem?.price === 'number' ? sourceItem.price : null,
    compareAtPrice: null,
    currency,
    inventoryQty,
    isInStock
  };

  return {
    id: randomUUID(),
    sourceId: sourceItem?.id !== undefined && sourceItem?.id !== null ? String(sourceItem.id) : null,
    source: 'magento',
    storeId,
    sku,
    title: typeof sourceItem?.name === 'string' ? sourceItem.name : '',
    description: extractCustomAttribute(customAttributes, 'description'),
    brand: extractCustomAttribute(customAttributes, 'brand'),
    category: extractCustomAttribute(customAttributes, 'category'),
    productType: sourceItem?.type_id || null,
    tags: [],
    status: sourceItem?.status === 1 ? 'active' : sourceItem?.status === 2 ? 'inactive' : null,
    weight: typeof sourceItem?.weight === 'number' ? sourceItem.weight : null,
    images,
    attributes,
    variants: [variant],
    categoryIds: [],
    createdAt: normalizeDateTime(sourceItem?.created_at),
    updatedAt: normalizeDateTime(sourceItem?.updated_at),
    lastSyncedAt: new Date().toISOString(),
    cleanedTitle: cleanTitle(sourceItem?.name || ''),
    normalizedBrand: extractCustomAttribute(customAttributes, 'brand')
      ? extractCustomAttribute(customAttributes, 'brand').toLowerCase().trim()
      : null,
    pricePerUnit: null
  };
}

/**
 * Transform Magento category node into canonical category.
 * @param {object} node
 * @param {string|null} parentCanonicalId
 * @param {string} storeId
 * @returns {object}
 */
function transformCategory(node, parentCanonicalId, storeId) {
  const sourceNode = node || {};
  const customAttributes = safeArray(sourceNode?.custom_attributes);

  return {
    id: randomUUID(),
    sourceId: sourceNode?.id !== undefined && sourceNode?.id !== null ? String(sourceNode.id) : null,
    source: 'magento',
    storeId,
    name: typeof sourceNode?.name === 'string' ? sourceNode.name : '',
    slug: extractCustomAttribute(customAttributes, 'url_key'),
    description: extractCustomAttribute(customAttributes, 'description'),
    parentId: parentCanonicalId || null,
    level: typeof sourceNode?.level === 'number' ? sourceNode.level : null,
    isActive: typeof sourceNode?.is_active === 'boolean' ? sourceNode.is_active : true,
    includeInMenu: sourceNode?.include_in_menu ?? null,
    path: sourceNode?.path || null,
    children: sourceNode?.children
      ? String(sourceNode.children)
          .split(',')
          .filter(Boolean)
      : [],
    position: typeof sourceNode?.position === 'number' ? sourceNode.position : null,
    availableSortBy: Array.isArray(sourceNode?.available_sort_by)
      ? sourceNode.available_sort_by
      : [],
    imageUrl: null,
    productCount: null,
    treeId: null,
    createdAt: normalizeDateTime(sourceNode?.created_at),
    updatedAt: normalizeDateTime(sourceNode?.updated_at),
    lastSyncedAt: new Date().toISOString()
  };
}

module.exports = { transformProduct, transformCategory, extractCustomAttribute };
