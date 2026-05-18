const cheerio = require('cheerio');
const mongoose = require('mongoose');
const logger = require('../logger.service');
const { connectDB } = require('../db.service');
const { normalizePrice } = require('./price.normalizer');

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

function normalizeAvailability(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).toLowerCase();
  if (normalized.includes('outofstock') || normalized.includes('out_of_stock')) {
    return 'out_of_stock';
  }
  if (normalized.includes('preorder')) {
    return 'preorder';
  }
  if (normalized.includes('instock') || normalized.includes('in_stock')) {
    return 'in_stock';
  }
  return normalized;
}

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

  const hasPrice = Number.isFinite(product?.price);
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
      continue;
    }
  }

  return null;
}

async function extractFromJsonLd(product, url) {
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

  const availability = normalizeAvailability(offers?.availability || product?.availability || null);
  const sku = product.sku || offers?.sku || product.productID || null;
  const images = normalizeImages(product.image || product.images || null);

  return {
    id: null,
    sourceId: url || null,
    source: 'scraped',
    storeId: null,
    title: product.name || null,
    description: product.description || null,
    brand: brand || null,
    category: product.category || null,
    attributes: {},
    images,
    variants: [],
    price: normalizedPrice.amount,
    currency,
    availability,
    sku: sku || null,
    url: url || null,
    lastSyncedAt: new Date().toISOString()
  };
}

async function extractFromOpenGraph($, url) {
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

  return {
    id: null,
    sourceId: url || null,
    source: 'scraped',
    storeId: null,
    title: title || null,
    description: description || null,
    brand: null,
    category: null,
    attributes: {},
    images: normalizeImages(image || null),
    variants: [],
    price: normalizedPrice.amount,
    currency: priceCurrency || normalizedPrice.currency,
    availability: normalizeAvailability(availability || null),
    sku: null,
    url: url || null,
    lastSyncedAt: new Date().toISOString()
  };
}

async function extractFromSelectors($, selectors, url) {
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

  return {
    id: null,
    sourceId: url || null,
    source: 'scraped',
    storeId: null,
    title: title || null,
    description: null,
    brand: null,
    category: null,
    attributes: {},
    images,
    variants: [],
    price: normalizedPrice.amount,
    currency: normalizedPrice.currency,
    availability: normalizeAvailability(availability || null),
    sku: null,
    url: url || null,
    lastSyncedAt: new Date().toISOString()
  };
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
  try {
    const $ = cheerio.load(html || '');

    const jsonLdProduct = parseJsonLd($);
    if (jsonLdProduct) {
      const product = await extractFromJsonLd(jsonLdProduct, url);
      if (!isLikelyProductExtraction(product)) {
        logger.warn({
          message: 'Low quality extraction detected',
          service: 'scraper',
          extractionLevel: 'json-ld',
          url
        });
        return { product: null, needsAiSelectors: true };
      }
      logger.info({
        message: 'Extraction successful',
        service: 'scraper',
        extractionLevel: 'json-ld',
        url
      });
      return { product, needsAiSelectors: false };
    }

    const ogProduct = await extractFromOpenGraph($, url);
    if (ogProduct) {
      if (!isLikelyProductExtraction(ogProduct)) {
        logger.warn({
          message: 'Low quality extraction detected',
          service: 'scraper',
          extractionLevel: 'open-graph',
          url
        });
        return { product: null, needsAiSelectors: true };
      }
      logger.info({
        message: 'Extraction successful',
        service: 'scraper',
        extractionLevel: 'open-graph',
        url
      });
      return { product: ogProduct, needsAiSelectors: false };
    }

    const selectors = await loadSelectorCache(url);
    if (selectors) {
      const selectorProduct = await extractFromSelectors($, selectors, url);
      if (selectorProduct) {
        if (!isLikelyProductExtraction(selectorProduct)) {
          logger.warn({
            message: 'Low quality extraction detected',
            service: 'scraper',
            extractionLevel: 'cached-selectors',
            url
          });
          return { product: null, needsAiSelectors: true };
        }
        logger.info({
          message: 'Extraction successful',
          service: 'scraper',
          extractionLevel: 'cached-selectors',
          url
        });
        return { product: selectorProduct, needsAiSelectors: false };
      }
    }

    // TODO: Plug in AI selector generation for unknown layouts.
    logger.warn({
      message: 'Extraction failed',
      service: 'scraper',
      extractionLevel: 'failed',
      url
    });
    return { product: null, needsAiSelectors: true };
  } catch (error) {
    logger.error({
      message: 'Product extraction failed',
      service: 'scraper',
      url,
      error: error?.message || String(error)
    });
    logger.warn({
      message: 'Extraction failed',
      service: 'scraper',
      extractionLevel: 'failed',
      url
    });
    return { product: null, needsAiSelectors: true };
  }
}

module.exports = { extractProductData };
