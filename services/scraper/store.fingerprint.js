const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const mongoose = require('mongoose');
const logger = require('../logger.service');
const { connectDB } = require('../db.service');

const KNOWN_PLATFORM_SUFFIXES = [
  'myshopify.com',
  'mybigcommerce.com',
  'mymagento.com',
  'mywoocommerce.com'
];

function normalizeDomain(input) {
  if (!input) {
    return null;
  }

  const raw = String(input).trim();
  if (!raw) {
    return null;
  }

  let hostname = '';
  try {
    const url = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`);
    hostname = url.hostname || '';
  } catch (error) {
    void error;
    const cleaned = raw
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .split('?')[0]
      .split('#')[0];
    hostname = cleaned;
  }

  let normalized = hostname.toLowerCase();
  if (normalized.startsWith('www.')) {
    normalized = normalized.slice(4);
  }
  normalized = normalized.replace(/\/+$/, '');

  const isKnownPlatform = KNOWN_PLATFORM_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`)
  );

  // Subdomain dedup: shop.brand.com and store.brand.com collapse to brand.com,
  // but known platform subdomains (mystore.myshopify.com) remain intact.
  if (isKnownPlatform) {
    return normalized;
  }

  const parts = normalized.split('.');
  if (parts.length <= 2) {
    return normalized;
  }

  return parts.slice(-2).join('.');
}

function detectPlatform(html, domain) {
  const normalizedDomain = typeof domain === 'string' ? domain.toLowerCase() : '';

  if (normalizedDomain.endsWith('myshopify.com')) {
    return 'shopify';
  }
  if (normalizedDomain.endsWith('mybigcommerce.com')) {
    return 'bigcommerce';
  }
  if (normalizedDomain.endsWith('mymagento.com')) {
    return 'magento';
  }

  if (!html) {
    return 'unknown';
  }

  const lowerHtml = String(html).toLowerCase();

  if (lowerHtml.includes('/cdn/shop/') || lowerHtml.includes('cdn.shopify.com')) {
    return 'shopify';
  }
  if (lowerHtml.includes('wp-content/plugins/woocommerce')) {
    return 'woocommerce';
  }
  if (lowerHtml.includes('cdn11.bigcommerce.com') || lowerHtml.includes('cdn10.bigcommerce.com')) {
    return 'bigcommerce';
  }
  if (lowerHtml.includes('static/version') || lowerHtml.includes('magento_')) {
    return 'magento';
  }

  const $ = cheerio.load(html);
  const generator = $('meta[name="generator"]').attr('content') || '';
  if (generator.toLowerCase().includes('woocommerce')) {
    return 'woocommerce';
  }

  return 'unknown';
}

function generateStoreId(normalizedDomain) {
  const hash = crypto
    .createHash('sha256')
    .update(String(normalizedDomain))
    .digest('hex')
    .slice(0, 16);
  return `store_${hash}`;
}

async function fetchHtml(url) {
  if (!url) {
    return null;
  }

  const fetchUrl = url.includes('://') ? url : `https://${url}`;
  try {
    const response = await axios.get(fetchUrl, { timeout: 15000 });
    return typeof response?.data === 'string' ? response.data : null;
  } catch (error) {
    logger.warn({
      message: 'Fingerprint HTML fetch failed',
      service: 'scraper',
      url: fetchUrl,
      error: error?.message || String(error)
    });
    return null;
  }
}

async function fingerprintStore(url) {
  try {
    const normalizedDomain = normalizeDomain(url);
    if (!normalizedDomain) {
      logger.warn({
        message: 'Store fingerprint failed due to invalid domain',
        service: 'scraper',
        url
      });
      return null;
    }

    await connectDB();
    const collection = mongoose.connection.collection('stores');
    const domainCandidates = [
      normalizedDomain,
      `https://${normalizedDomain}`,
      `http://${normalizedDomain}`,
      `https://www.${normalizedDomain}`,
      `http://www.${normalizedDomain}`,
      `www.${normalizedDomain}`
    ];

    const existing = await collection.findOne({ domain: { $in: domainCandidates } });
    if (existing) {
      return {
        ...existing,
        isNewStore: false,
        detectedPlatform: existing.platform || 'unknown',
        normalizedDomain,
        source: existing.source || 'scraped'
      };
    }

    let detectedPlatform = detectPlatform('', normalizedDomain);
    let html = null;
    if (detectedPlatform === 'unknown') {
      html = await fetchHtml(url || normalizedDomain);
      detectedPlatform = detectPlatform(html, normalizedDomain);
    }

    if (detectedPlatform !== 'unknown') {
      logger.warn({
        message: 'Known platform detected via scraper — consider switching to API connector',
        service: 'scraper',
        url,
        domain: normalizedDomain,
        platform: detectedPlatform
      });
    }

    const storeId = generateStoreId(normalizedDomain);
    const createdAt = new Date().toISOString();
    const storeDoc = {
      id: storeId,
      name: normalizedDomain,
      platform: detectedPlatform === 'unknown' ? 'generic' : detectedPlatform,
      domain: normalizedDomain,
      isActive: true,
      syncFrequency: 'daily',
      ingestionType: 'scraped',
      metaData: {
        discoveredAt: createdAt
      },
      createdAt,
      lastSyncedAt: null,
      source: 'scraped'
    };

    const result = await collection.updateOne(
      { domain: normalizedDomain },
      { $setOnInsert: storeDoc },
      { upsert: true }
    );

    const isNewStore = Boolean(result?.upsertedId);
    if (isNewStore) {
      logger.info({
        message: 'New store discovered',
        service: 'scraper',
        storeId,
        domain: normalizedDomain,
        platform: storeDoc.platform
      });
    }

    const stored = await collection.findOne({ domain: normalizedDomain });
    return {
      ...(stored || storeDoc),
      isNewStore,
      detectedPlatform,
      normalizedDomain,
      source: storeDoc.source
    };
  } catch (error) {
    logger.error({
      message: 'Store fingerprint failed',
      service: 'scraper',
      url,
      error: error?.message || String(error)
    });
    return null;
  }
}

module.exports = {
  normalizeDomain,
  detectPlatform,
  generateStoreId,
  fingerprintStore
};
