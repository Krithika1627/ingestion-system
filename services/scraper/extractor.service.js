const cheerio = require('cheerio');
const mongoose = require('mongoose');
const logger = require('../logger.service');
const { connectDB } = require('../db.service');
const { normalizePrice } = require('./price.normalizer');
const { normalizeAvailability } = require('./availability.normalizer');
const { generateSelectors } = require('./ai.selector');

const SelectorCacheSchema = new mongoose.Schema(
  {
    domain: { type: String, required: true, unique: true },
    selectors: {
      title: String,
      price: String,
      images: String,
      availability: String,
      variants: String
    },
    createdAt: { type: Date, default: Date.now }
  },
  { collection: 'selector_cache', versionKey: false }
);

const SelectorCache =
  mongoose.models.SelectorCache ||
  mongoose.model('SelectorCache', SelectorCacheSchema);

const GENERIC_PHRASES = [
  'official website',
  'home page',
  'visit now',
  'home',
  'homepage',
  'welcome',
  'all rights reserved'
];

const LOG_FIELDS = [
  'title',
  'description',
  'brand',
  'category',
  'images',
  'variants',
  'price',
  'currency',
  'sku',
  'cleanedTitle',
  'normalizedBrand'
];


function getMetaContent($, key) {
  const metaByProperty = $(`meta[property="${key}"]`).attr('content');
  if (metaByProperty) {
    return metaByProperty.trim();
  }

  const metaByName = $(`meta[name="${key}"]`).attr('content');
  if (metaByName) {
    return metaByName.trim();
  }

  return null;
}

function normalizeImages(images) {
  const seen = new Set();
  const normalized = [];
  const list = Array.isArray(images) ? images : images ? [images] : [];

  list.forEach((item, index) => {
    const url = typeof item === 'string' ? item : item?.url;
    if (!url) {
      return;
    }
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    normalized.push({ url: trimmed, altText: null, position: index });
    seen.add(trimmed);
  });

  return normalized;
}

function normalizeText(value) {
  if (!value) {
    return '';
  }

  return String(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function containsGenericPhrase(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  return GENERIC_PHRASES.some((phrase) => normalized.includes(phrase));
}

function isLikelyProductExtraction(product) {
  if (!product) {
    return false;
  }

  const title = normalizeText(product?.title);
  if (!title || title.length < 5) {
    return false;
  }

  if (containsGenericPhrase(title)) {
    return false;
  }

  if (containsGenericPhrase(product?.description)) {
    return false;
  }

  const hasPrice = Number.isFinite(product?.price?.amount);
  const hasImages = Array.isArray(product?.images) && product.images.length > 0;
  if (!hasPrice && !hasImages) {
    return false;
  }

  return true;
}

function findProductInJsonLd(data) {
  if (!data) {
    return null;
  }

  if (Array.isArray(data)) {
    for (const entry of data) {
      const found = findProductInJsonLd(entry);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (typeof data === 'object') {
    const type = data['@type'] || data.type;
    const typeList = Array.isArray(type) ? type : type ? [type] : [];

    if (typeList.map((value) => String(value).toLowerCase()).includes('product')) {
      return data;
    }

    if (Array.isArray(data['@graph'])) {
      for (const entry of data['@graph']) {
        const found = findProductInJsonLd(entry);
        if (found) {
          return found;
        }
      }
    }
  }

  return null;
}

function parseJsonLd($) {
  const scripts = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (raw) {
      scripts.push(raw.trim());
    }
  });

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script);
      const product = findProductInJsonLd(parsed);
      if (product) {
        return product;
      }
    } catch (error) {
      void error;
      continue;
    }
  }

  return null;
}

async function extractFromJsonLd(product) {
  if (!product) {
    return null;
  }

  const brand =
    typeof product.brand === 'string'
      ? product.brand
      : product.brand?.name || null;

  const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  const rawPrice = offers?.price || offers?.priceSpecification?.price || null;
  const rawCurrency = offers?.priceCurrency || offers?.priceSpecification?.priceCurrency || null;
  const normalizedPrice = await normalizePrice(rawPrice || '');
  const currency = rawCurrency || normalizedPrice.currency;

  const availability = normalizeAvailability(
    offers?.availability || product?.availability || null
  );
  const sku = product.sku || offers?.sku || product.productID || null;
  const images = normalizeImages(product.image || product.images || null);
  const price = Number.isFinite(normalizedPrice.amount)
    ? { amount: normalizedPrice.amount, currency }
    : null;

  return {
    title: product.name || null,
    description: product.description || null,
    brand: brand || null,
    category: product.category || null,
    images,
    price,
    availability,
    sku: sku || null
  };
}

async function extractFromOpenGraph($) {
  const title = getMetaContent($, 'og:title');
  const description = getMetaContent($, 'og:description');
  const image = getMetaContent($, 'og:image');
  const priceAmount =
    getMetaContent($, 'product:price:amount') ||
    getMetaContent($, 'og:price:amount');
  const priceCurrency =
    getMetaContent($, 'product:price:currency') ||
    getMetaContent($, 'og:price:currency');
  const availability =
    getMetaContent($, 'product:availability') ||
    getMetaContent($, 'og:availability');

  if (!title && !description && !image && !priceAmount) {
    return null;
  }

  const normalizedPrice = await normalizePrice(priceAmount || '');
  const price = Number.isFinite(normalizedPrice.amount)
    ? {
        amount: normalizedPrice.amount,
        currency: priceCurrency || normalizedPrice.currency
      }
    : null;

  return {
    title: title || null,
    description: description || null,
    brand: null,
    category: null,
    images: normalizeImages(image || null),
    price,
    availability: normalizeAvailability(availability || null),
    sku: null
  };
}

async function extractFromSelectors($, selectors) {
  if (!selectors || typeof selectors !== 'object') {
    return null;
  }

  const readSelectorText = (selector) => {
    if (!selector) {
      return null;
    }
    const element = $(selector).first();
    const content = element.attr('content');
    const text = content || element.text();
    return text ? text.trim() : null;
  };

  const title = readSelectorText(selectors.title);
  const price = readSelectorText(selectors.price);
  const availability = readSelectorText(selectors.availability);

  const images = selectors.images
    ? $(selectors.images)
        .map((index, el) => {
          const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('content');
          const trimmed = src ? src.trim() : '';
          if (!trimmed) {
            return null;
          }
          return { url: trimmed, altText: null, position: index };
        })
        .get()
        .filter(Boolean)
    : [];

  if (!title && !price && images.length === 0) {
    return null;
  }

  const normalizedPrice = await normalizePrice(price || '');
  const pricePayload = Number.isFinite(normalizedPrice.amount)
    ? { amount: normalizedPrice.amount, currency: normalizedPrice.currency }
    : null;

  return {
    title: title || null,
    description: null,
    brand: null,
    category: null,
    images,
    price: pricePayload,
    availability: normalizeAvailability(availability || null),
    sku: null
  };
}

function cleanTitle(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = value
    .replace(/<[^>]+>/g, '')
    .replace(/[®™©]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}

function normalizeBrandValue(value) {
  if (!value) {
    return null;
  }
  return String(value).toLowerCase().trim() || null;
}

function hasTitleAndPrice(extracted) {
  const title = typeof extracted?.title === 'string' ? extracted.title.trim() : '';
  const hasTitle = Boolean(title);
  const amount = extracted?.price?.amount;
  const hasPrice = Number.isFinite(amount);
  return hasTitle && hasPrice;
}

function buildCanonicalProduct(extracted, url) {
  const title = typeof extracted?.title === 'string' ? extracted.title.trim() : '';
  const sourceId = url || null;
  const sku = typeof extracted?.sku === 'string' ? extracted.sku.trim() : null;
  const priceAmount = extracted?.price?.amount;
  const currency = extracted?.price?.currency || 'USD';
  const availability = extracted?.availability || 'unknown';
  const isInStock = availability === 'in_stock' || availability === 'limited_stock';

  return {
    id: null,
    sourceId,
    source: 'scraped',
    storeId: null,
    sku,
    title,
    description: extracted?.description || null,
    brand: extracted?.brand || null,
    category: extracted?.category || null,
    productType: 'unknown',
    tags: [],
    status: 'active',
    weight: null,
    images: Array.isArray(extracted?.images) ? extracted.images : [],
    attributes: {},
    variants: [
      {
        variantId: sku || sourceId,
        title: null,
        sku: sku || null,
        price: Number.isFinite(priceAmount) ? priceAmount : 0,
        compareAtPrice: null,
        currency,
        inventoryQty: null,
        isInStock
      }
    ],
    categoryIds: [],
    createdAt: null,
    updatedAt: null,
    lastSyncedAt: new Date().toISOString(),
    cleanedTitle: cleanTitle(title),
    normalizedBrand: normalizeBrandValue(extracted?.brand),
    pricePerUnit: null
  };
}

function getFieldStatus(product) {
  const variant = product?.variants?.[0] || null;
  const fields = {
    title: product?.title || null,
    description: product?.description || null,
    brand: product?.brand || null,
    category: product?.category || null,
    images: Array.isArray(product?.images) && product.images.length > 0 ? product.images : null,
    variants: Array.isArray(product?.variants) && product.variants.length > 0 ? product.variants : null,
    price: Number.isFinite(variant?.price) ? variant.price : null,
    currency: variant?.currency || null,
    sku: product?.sku || null,
    cleanedTitle: product?.cleanedTitle || null,
    normalizedBrand: product?.normalizedBrand || null
  };

  const fieldsFound = [];
  const fieldsMissing = [];

  Object.entries(fields).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      fieldsMissing.push(key);
    } else {
      fieldsFound.push(key);
    }
  });

  return { fieldsFound, fieldsMissing };
}

async function loadSelectorCache(url) {
  try {
    const domain = new URL(url).hostname;
    await connectDB();
    const cached = await SelectorCache.findOne({ domain }).lean();
    return cached?.selectors || null;
  } catch (error) {
    logger.error({
      message: 'Selector cache lookup failed',
      service: 'scraper',
      url,
      error: error?.message || String(error)
    });
    return null;
  }
}

async function extractProductData(html, url) {
  const timestamp = new Date().toISOString();
  let domain = null;
  let extractionSource = 'failed';

  try {
    if (url) {
      try {
        domain = new URL(url).hostname;
      } catch (error) {
        void error;
        domain = null;
      }
    }
    const $ = cheerio.load(html || '');
    let extracted = null;

    const jsonLdProduct = parseJsonLd($);
    if (jsonLdProduct) {
      const product = await extractFromJsonLd(jsonLdProduct);
      if (product && hasTitleAndPrice(product) && isLikelyProductExtraction(product)) {
        extracted = product;
        extractionSource = 'json-ld';
      }
    }

    if (!extracted) {
      const ogProduct = await extractFromOpenGraph($);
      if (ogProduct && hasTitleAndPrice(ogProduct) && isLikelyProductExtraction(ogProduct)) {
        extracted = ogProduct;
        extractionSource = 'open-graph';
      }
    }

    if (!extracted) {
      const selectors = await loadSelectorCache(url);
      if (selectors) {
        const selectorProduct = await extractFromSelectors($, selectors);
        if (
          selectorProduct &&
          hasTitleAndPrice(selectorProduct) &&
          isLikelyProductExtraction(selectorProduct)
        ) {
          extracted = selectorProduct;
          extractionSource = 'cached-selectors';
        }
      }
    }

    if (!extracted) {
      const aiSelectors = await generateSelectors(html, url);
      if (aiSelectors) {
        const aiProduct = await extractFromSelectors($, aiSelectors);
        if (aiProduct && hasTitleAndPrice(aiProduct) && isLikelyProductExtraction(aiProduct)) {
          extracted = aiProduct;
          extractionSource = 'ai-generated';
        }
      }
    }

    if (!extracted) {
      logger.warn({
        message: 'Extraction failed',
        service: 'scraper',
        url,
        domain,
        timestamp,
        reason: 'all extraction methods failed'
      });
      logger.warn({
        url,
        domain,
        source: 'failed',
        fieldsFound: [],
        fieldsMissing: [...LOG_FIELDS],
        timestamp
      });
      return { product: null, needsAiSelectors: true };
    }

    const canonicalProduct = buildCanonicalProduct(extracted, url);
    const { fieldsFound, fieldsMissing } = getFieldStatus(canonicalProduct);
    logger.info({
      url,
      domain,
      source: extractionSource,
      fieldsFound,
      fieldsMissing,
      timestamp
    });

    return { product: canonicalProduct, needsAiSelectors: false };
  } catch (error) {
    logger.error({
      message: 'Product extraction failed',
      service: 'scraper',
      url,
      error: error?.message || String(error)
    });
    logger.warn({
      url,
      domain,
      source: 'failed',
      fieldsFound: [],
      fieldsMissing: [...LOG_FIELDS],
      timestamp
    });
    return { product: null, needsAiSelectors: true };
  }
}

module.exports = { extractProductData };
