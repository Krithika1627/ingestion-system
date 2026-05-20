require('dotenv').config();

const axios = require('axios');
const logger = require('../services/logger.service');
const {
  normalizeDomain,
  detectPlatform,
  generateStoreId,
  fingerprintStore
} = require('../services/scraper/store.fingerprint');

const TEST_URLS = [
  'https://www.mamaearth.in/product/something',
  'https://shop.mamaearth.in',
  'https://mystore.myshopify.com/products/shoes',
  'https://www.bewakoof.com/p/something',
  'https://demo.woothemes.com/storefront',
  'https://mystore.mybigcommerce.com'
];

async function fetchHtml(url) {
  try {
    const response = await axios.get(url, { timeout: 15000 });
    return typeof response?.data === 'string' ? response.data : null;
  } catch (error) {
    logger.warn({
      message: 'Test HTML fetch failed',
      service: 'scraper-test',
      url,
      error: error?.message || String(error)
    });
    return null;
  }
}

async function run() {
  for (const inputUrl of TEST_URLS) {
    const normalizedDomain = normalizeDomain(inputUrl);
    const html = await fetchHtml(inputUrl);
    const detectedPlatform = detectPlatform(html, normalizedDomain);
    const storeId = normalizedDomain ? generateStoreId(normalizedDomain) : null;

    const storeRecord = await fingerprintStore(inputUrl);
    const isNewStore = Boolean(storeRecord?.isNewStore);

    logger.info({
      inputUrl,
      normalizedDomain,
      detectedPlatform,
      storeId,
      isNewStore,
      source: storeRecord?.source || 'scraped'
    });
  }
  process.exit(0);
}

run();
