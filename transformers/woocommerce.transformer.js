const { randomUUID } = require('crypto');

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNullableString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stripHtml(str) {
  if (typeof str !== 'string') {
    return null;
  }
  const cleaned = str.replace(/<[^>]*>/g, '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function extractBrand(product) {
  const brands = safeArray(product?.brands);
  if (brands.length > 0) {
    return toNullableString(brands[0]?.name);
  }

  const attributes = safeArray(product?.attributes);
  const brandAttribute = attributes.find((attr) => {
    const name = typeof attr?.name === 'string' ? attr.name.toLowerCase() : '';
    const slug = typeof attr?.slug === 'string' ? attr.slug.toLowerCase() : '';
    return name === 'brand' || slug === 'pa_brand';
  });

  if (brandAttribute && Array.isArray(brandAttribute.options)) {
    return toNullableString(brandAttribute.options[0]);
  }

  return null;
}

function parseNumber(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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

function transformProduct(item, storeId) {
  const sourceItem = item || {};
  const categories = safeArray(sourceItem?.categories);
  const tags = safeArray(sourceItem?.tags)
    .map((tag) => tag?.name)
    .filter(Boolean);
  const images = safeArray(sourceItem?.images)
    .map((image, index) => {
      const url = typeof image?.src === 'string' ? image.src.trim() : '';
      if (!url) {
        return null;
      }
      return {
        url,
        altText: toNullableString(image?.alt),
        position: index
      };
    })
    .filter(Boolean);

  const attributes = safeArray(sourceItem?.attributes).reduce((acc, attr) => {
    const name = typeof attr?.name === 'string' ? attr.name : null;
    const slug = typeof attr?.slug === 'string' ? attr.slug : null;
    if (!name) {
      return acc;
    }
    if (name.toLowerCase() === 'brand' || (slug && slug.toLowerCase() === 'pa_brand')) {
      return acc;
    }
    const options = Array.isArray(attr?.options) ? attr.options : [];
    if (options.length === 0) {
      return acc;
    }
    acc[name] = options.join(', ');
    return acc;
  }, {});

  const sku = toNullableString(sourceItem?.sku);
  const categoryIds = categories
    .map((category) => (category?.id !== undefined && category?.id !== null ? String(category.id) : null))
    .filter(Boolean);
  const brand = extractBrand(sourceItem);
  const price = parseNumber(sourceItem?.price);
  const regularPrice = parseNumber(sourceItem?.regular_price);
  const onSale = Boolean(sourceItem?.on_sale);
  const inventoryQty = sourceItem?.manage_stock ? sourceItem?.stock_quantity ?? null : null;

  const variant = {
    variantId: sku || (sourceItem?.id !== undefined && sourceItem?.id !== null ? String(sourceItem.id) : null),
    title: null,
    sku: sku || null,
    price: Number.isFinite(price) ? price : 0,
    compareAtPrice: onSale && Number.isFinite(regularPrice) ? regularPrice : null,
    currency: 'INR',
    inventoryQty,
    isInStock: sourceItem?.stock_status === 'instock'
  };

  return {
    id: randomUUID(),
    sourceId: sourceItem?.id !== undefined && sourceItem?.id !== null ? String(sourceItem.id) : null,
    source: 'woocommerce',
    storeId,
    sku,
    title: typeof sourceItem?.name === 'string' ? sourceItem.name : '',
    description: stripHtml(sourceItem?.description),
    brand,
    category: categories?.[0]?.name || null,
    productType: sourceItem?.type || null,
    tags,
    status:
      sourceItem?.status === 'publish'
        ? 'active'
        : sourceItem?.status === 'draft'
          ? 'draft'
          : sourceItem?.status === 'private'
            ? 'inactive'
            : sourceItem?.status === 'trash'
              ? 'archived'
              : null,
    weight: Number.isFinite(parseNumber(sourceItem?.weight))
      ? parseNumber(sourceItem?.weight)
      : null,
    images,
    attributes,
    variants: [variant],
    categoryIds,
    createdAt: item.date_created
      ? new Date(item.date_created).toISOString()
      : null,

    updatedAt: item.date_modified
      ? new Date(item.date_modified).toISOString()
      : null,
    lastSyncedAt: new Date().toISOString(),
    cleanedTitle: cleanTitle(sourceItem?.name || ''),
    normalizedBrand: brand ? brand.toLowerCase().trim() : null,
    pricePerUnit: null
  };
}

function transformCategory(node, storeId) {
  const sourceNode = node || {};
  const parentSourceId =
    sourceNode?.parent === 0 || sourceNode?.parent === '0'
      ? null
      : sourceNode?.parent !== undefined && sourceNode?.parent !== null
        ? String(sourceNode.parent)
        : null;

  return {
    id: randomUUID(),
    sourceId: sourceNode?.id !== undefined && sourceNode?.id !== null ? String(sourceNode.id) : null,
    source: 'woocommerce',
    storeId,
    name: typeof sourceNode?.name === 'string' ? sourceNode.name : '',
    slug: toNullableString(sourceNode?.slug),
    description: toNullableString(sourceNode?.description),
    parentSourceId,
    parentId: null,
    level: parentSourceId ? 1 : 0,    isActive: true,
    includeInMenu: true,
    path: null,
    children: [],
    position: typeof sourceNode?.menu_order === 'number' ? sourceNode.menu_order : null,
    imageUrl: sourceNode?.image?.src || null,
    productCount: typeof sourceNode?.count === 'number' ? sourceNode.count : null,
    treeId: null,
    createdAt: null,
    updatedAt: null,
    lastSyncedAt: new Date().toISOString()
  };
}

module.exports = { transformProduct, transformCategory, extractBrand, stripHtml };
