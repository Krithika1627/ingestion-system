/**
 * WooCommerce connector with mock mode, pagination, retries, and rate-limit delays.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../services/logger.service');

const USE_MOCK = process.env.WOO_USE_MOCK === 'true';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_RATE_LIMIT_DELAY = 500;
const DEFAULT_RETRY_ATTEMPTS = 3;
const RETRY_STATUSES = new Set([429, 500, 502, 503]);

/**
 * Sleep for a duration in milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve a store identifier from input.
 * @param {object|string} store
 * @returns {string}
 */
function getStoreId(store) {
  if (typeof store === 'string') {
    return store;
  }
  return store?.id || store?.storeId || 'store_woo_001';
}

/**
 * Resolve sync configuration from input.
 * @param {object} store
 * @returns {object}
 */
function getSyncConfig(store) {
  return store?.syncConfig || {};
}

/**
 * Build a WooCommerce API URL with auth query params.
 * @param {string} pathName
 * @param {object} extraParams
 * @returns {string}
 */
function buildUrl(pathName, extraParams = {}) {
  const baseUrl = process.env.WOO_STORE_URL;

  if (!baseUrl) {
    throw new Error('WOO_STORE_URL is not configured');
  }

  const url = new URL(
    `${baseUrl.replace(/\/$/, '')}/wp-json/wc/v3${pathName}`
  );

  Object.entries(extraParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

/**
 * Load WooCommerce mock data from disk.
 * @returns {object}
 */
function loadMockData() {
  const mockPath = path.join(__dirname, '..', 'mock-data', 'woocommerce-mock.json');
  const raw = fs.readFileSync(mockPath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Execute a request function with retry and backoff.
 * @param {Function} requestFn
 * @param {object} context
 * @returns {Promise<any>}
 */
async function requestWithRetry(requestFn, context) {
  const retryAttempts = context?.retryAttempts || DEFAULT_RETRY_ATTEMPTS;

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      return await requestFn();
    } catch (error) {
      const status = error?.response?.status;
      const isRetriable = status ? RETRY_STATUSES.has(status) : true;
      if (!isRetriable || attempt === retryAttempts || [401, 403, 404].includes(status)) {
        logger.error({
          message: 'WooCommerce request failed',
          platform: 'woocommerce',
          attempt,
          status: status || 'network',
          error: error?.message || String(error),
          ...context
        });
        throw error;
      }

      const waitMs = 1000 * 2 ** (attempt - 1);
      logger.warn({
        message: 'Retrying WooCommerce request',
        platform: 'woocommerce',
        attempt,
        waitMs,
        status: status || 'network',
        error: error?.message || String(error),
        ...context
      });
      await sleep(waitMs);
    }
  }

  throw new Error('WooCommerce request failed after retries');
}

/**
 * Fetch all products from WooCommerce with pagination.
 * @param {object|string} store
 * @returns {Promise<object[]>}
 */
async function fetchProducts(store) {
  const storeId = getStoreId(store);
  const syncConfig = getSyncConfig(store);
  const pageSize = Math.min(syncConfig.batchSize || DEFAULT_PAGE_SIZE, 100);
  const rateLimitDelay = syncConfig.rateLimitDelay || DEFAULT_RATE_LIMIT_DELAY;
  const retryAttempts = syncConfig.retryAttempts || DEFAULT_RETRY_ATTEMPTS;
  const startTime = Date.now();
  const mode = USE_MOCK ? 'mock' : 'real';

  logger.info({
    message: 'WooCommerce product sync started',
    platform: 'woocommerce',
    storeId,
    mode
  });

  if (USE_MOCK) {
    logger.warn({
      message: 'Running in mock mode — using woocommerce-mock.json',
      platform: 'woocommerce',
      storeId
    });

    const mock = loadMockData();

    const items = Array.isArray(mock)
      ? mock.flatMap(entry => entry.products || [])
      : [];

    logger.info({
      message: 'WooCommerce product sync complete',
      platform: 'woocommerce',
      storeId,
      total: items.length,
      durationSec: Number(((Date.now() - startTime) / 1000).toFixed(2))
    });

    return items;
  }

  let currentPage = 1;
  let totalPages = null;
  const allItems = [];

  while (true) {
    const url = buildUrl('/products', { per_page: pageSize, page: currentPage });

    const response = await requestWithRetry(
      () => axios.get(url, {
        auth: {
          username: process.env.WOO_CONSUMER_KEY,
          password: process.env.WOO_CONSUMER_SECRET,
        }
      }),
      { storeId, page: currentPage, retryAttempts }
    );

    const items = Array.isArray(response?.data) ? response.data : [];
    const headerTotalPages = response?.headers?.['x-wp-totalpages'];
    totalPages = headerTotalPages ? Number(headerTotalPages) : totalPages;

    allItems.push(...items);
    logger.info({
      message: 'WooCommerce products page fetched',
      platform: 'woocommerce',
      storeId,
      page: currentPage,
      count: items.length,
      totalPages
    });

    if (!items.length) {
      break;
    }

    if (typeof totalPages === 'number' && currentPage >= totalPages) {
      break;
    }

    if (rateLimitDelay > 0) {
      logger.info({
        message: 'WooCommerce rate limit delay',
        platform: 'woocommerce',
        storeId,
        delayMs: rateLimitDelay
      });
      await sleep(rateLimitDelay);
    }

    currentPage += 1;
  }

  logger.info({
    message: 'WooCommerce product sync complete',
    platform: 'woocommerce',
    storeId,
    total: allItems.length,
    durationSec: Number(((Date.now() - startTime) / 1000).toFixed(2))
  });

  return allItems;
}

/**
 * Fetch all categories from WooCommerce with pagination.
 * @param {object|string} store
 * @returns {Promise<object[]>}
 */
async function fetchCategories(store) {
  const storeId = getStoreId(store);
  const syncConfig = getSyncConfig(store);
  const rateLimitDelay = syncConfig.rateLimitDelay || DEFAULT_RATE_LIMIT_DELAY;
  const retryAttempts = syncConfig.retryAttempts || DEFAULT_RETRY_ATTEMPTS;
  const startTime = Date.now();
  const mode = USE_MOCK ? 'mock' : 'real';

  logger.info({
    message: 'WooCommerce category sync started',
    platform: 'woocommerce',
    storeId,
    mode
  });

  if (USE_MOCK) {
    logger.warn({
      message: 'Running in mock mode — using woocommerce-mock.json',
      platform: 'woocommerce',
      storeId
    });

    const mock = loadMockData();

    const categories = Array.isArray(mock)
      ? [
          ...new Map(
            mock
              .flatMap(entry => entry.categories || [])
              .map(category => [category.id, category])
          ).values()
        ]
      : [];

    logger.info({
      message: 'WooCommerce category sync complete',
      platform: 'woocommerce',
      storeId,
      total: categories.length,
      durationSec: Number(((Date.now() - startTime) / 1000).toFixed(2))
    });

    return categories;
  }

  let currentPage = 1;
  let totalPages = null;
  const allCategories = [];

  while (true) {
    const url = buildUrl('/products/categories', {
      per_page: 100,
      page: currentPage,
      hide_empty: false
    });

    const response = await requestWithRetry(
      () => axios.get(url),
      { storeId, page: currentPage, retryAttempts }
    );

    const items = Array.isArray(response?.data) ? response.data : [];
    const headerTotalPages = response?.headers?.['x-wp-totalpages'];
    totalPages = headerTotalPages ? Number(headerTotalPages) : totalPages;

    allCategories.push(...items);
    logger.info({
      message: 'WooCommerce categories page fetched',
      platform: 'woocommerce',
      storeId,
      page: currentPage,
      count: items.length,
      totalPages
    });

    if (!items.length) {
      break;
    }

    if (typeof totalPages === 'number' && currentPage >= totalPages) {
      break;
    }

    if (rateLimitDelay > 0) {
      logger.info({
        message: 'WooCommerce rate limit delay',
        platform: 'woocommerce',
        storeId,
        delayMs: rateLimitDelay
      });
      await sleep(rateLimitDelay);
    }

    currentPage += 1;
  }

  logger.info({
    message: 'WooCommerce category sync complete',
    platform: 'woocommerce',
    storeId,
    total: allCategories.length,
    durationSec: Number(((Date.now() - startTime) / 1000).toFixed(2))
  });

  return allCategories;
}

module.exports = { fetchProducts, fetchCategories };