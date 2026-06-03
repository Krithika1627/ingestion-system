/**
 * BigCommerce connector with mock mode, pagination, retries, and brand cache.
 */
const axios = require('axios');
const logger = require('../services/logger.service');

const http = axios.create({ timeout: 30000 });

const USE_MOCK = process.env.BIGCOMMERCE_USE_MOCK === 'true';
const DEFAULT_PAGE_SIZE = 250;
const DEFAULT_RATE_LIMIT_DELAY = 500;
const DEFAULT_RETRY_ATTEMPTS = 3;
const RETRY_STATUSES = new Set([500, 502, 503]);

// Brand cache populated per sync.
let brandMap = new Map();
let brandsLoaded = false;

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
  return store?.id || store?.storeId || 'store_bigcommerce_001';
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
 * Build BigCommerce authentication headers.
 * @returns {object}
 */
function buildHeaders() {
  const token = process.env.BIGCOMMERCE_ACCESS_TOKEN;
  if (!token) {
    throw new Error('BIGCOMMERCE_ACCESS_TOKEN is not configured');
  }
  return {
    'X-Auth-Token': token,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
}

/**
 * Build BigCommerce v3 API URL.
 * @param {string} pathName
 * @returns {string}
 */
function buildV3Url(pathName) {
  const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
  if (!storeHash) {
    throw new Error('BIGCOMMERCE_STORE_HASH is not configured');
  }
  return `https://api.bigcommerce.com/stores/${storeHash}/v3${pathName}`;
}

/**
 * Build BigCommerce v2 API URL.
 * @param {string} pathName
 * @returns {string}
 */
function buildV2Url(pathName) {
  const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
  if (!storeHash) {
    throw new Error('BIGCOMMERCE_STORE_HASH is not configured');
  }
  return `https://api.bigcommerce.com/stores/${storeHash}/v2${pathName}`;
}

/**
 * Execute a request function with retry and rate-limit handling.
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

      if (status === 429) {
        const resetHeader = error?.response?.headers?.['x-rate-limit-time-reset-ms'];
        const resetMs = Number.parseInt(resetHeader, 10);
        const waitMs = Number.isFinite(resetMs) ? resetMs : 1000;
        logger.warn({
          message: 'BigCommerce rate limit hit',
          platform: 'bigcommerce',
          attempt,
          waitMs,
          status,
          ...context
        });
        await sleep(waitMs);
        continue;
      }

      if (status && [401, 403, 404].includes(status)) {
        logger.error({
          message: 'BigCommerce request failed',
          platform: 'bigcommerce',
          attempt,
          status,
          error: error?.message || String(error),
          ...context
        });
        throw error;
      }

      const isRetriable = status ? RETRY_STATUSES.has(status) : true;
      if (!isRetriable || attempt === retryAttempts) {
        logger.error({
          message: 'BigCommerce request failed',
          platform: 'bigcommerce',
          attempt,
          status: status || 'network',
          error: error?.message || String(error),
          ...context
        });
        throw error;
      }

      const waitMs = 1000 * 2 ** (attempt - 1);
      logger.warn({
        message: 'Retrying BigCommerce request',
        platform: 'bigcommerce',
        attempt,
        waitMs,
        status: status || 'network',
        error: error?.message || String(error),
        ...context
      });
      await sleep(waitMs);
    }
  }

  throw new Error('BigCommerce request failed after retries');
}

/**
 * Load all brands into the module-level cache.
 * @returns {Promise<void>}
 */
async function loadBrands() {
  if (brandsLoaded) {
    return;
  }

  const headers = buildHeaders();
  let currentPage = 1;
  let totalPages = null;
  let totalLoaded = 0;

  while (true) {
    const params = { limit: DEFAULT_PAGE_SIZE, page: currentPage };
    const response = await requestWithRetry(
      () => http.get(buildV3Url('/catalog/brands'), { headers, params }),
      { page: currentPage }
    );

    const items = Array.isArray(response?.data?.data) ? response.data.data : [];
    const pagination = response?.data?.meta?.pagination;
    totalPages = pagination?.total_pages ?? totalPages;

    for (const brand of items) {
      if (brand?.id !== undefined && brand?.id !== null) {
        brandMap.set(brand.id, brand?.name || null);
      }
    }

    totalLoaded += items.length;

    if (items.length < DEFAULT_PAGE_SIZE || (totalPages && currentPage >= totalPages)) {
      break;
    }

    if (DEFAULT_RATE_LIMIT_DELAY > 0) {
      await sleep(DEFAULT_RATE_LIMIT_DELAY);
    }

    currentPage += 1;
  }

  brandsLoaded = true;
  logger.info({
    message: 'BigCommerce brands loaded',
    platform: 'bigcommerce',
    total: totalLoaded
  });
}

/**
 * Fetch all products from BigCommerce with pagination.
 * Supports incremental sync via optional since parameter.
 * @param {object|string} store
 * @param {Date|null} [since] - Only fetch products modified after this date
 * @returns {Promise<{products: object[], brandMap: Map}>}
 */
async function fetchProducts(store, since) {
  const storeId = getStoreId(store);
  const syncConfig = getSyncConfig(store);
  const pageSize = Math.min(syncConfig.batchSize || DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const rateLimitDelay = syncConfig.rateLimitDelay || DEFAULT_RATE_LIMIT_DELAY;
  const retryAttempts = syncConfig.retryAttempts || DEFAULT_RETRY_ATTEMPTS;
  const startTime = Date.now();
  const mode = USE_MOCK ? 'mock' : 'real';

  logger.info({
    message: 'BigCommerce product sync started',
    platform: 'bigcommerce',
    storeId,
    mode
  });

  if (USE_MOCK) {
    logger.warn({
      message: 'Running in mock mode - using bigcommerce-mock.json',
      platform: 'bigcommerce',
      storeId
    });

    const mock = require('../mock-data/bigcommerce-mock.json');
    const mockBrandMap = new Map(
      (mock?.[0]?.brandsAPI?.data || []).map((brand) => [brand.id, brand.name])
    );
    let allProducts = Array.isArray(mock)
      ? mock.flatMap((entry) => entry?.productsAPI?.data || [])
      : [];

    if (since) {
      const sinceTime = new Date(since).getTime();
      const totalBefore = allProducts.length;
      allProducts = allProducts.filter((product) => {
        const modified = product?.date_modified
          ? new Date(product.date_modified).getTime()
          : product?.updated_at
            ? new Date(product.updated_at).getTime()
            : 0;
        return modified >= sinceTime;
      });
      logger.info({
        message: 'BigCommerce mock incremental filter applied',
        platform: 'bigcommerce',
        storeId,
        since: since.toISOString(),
        filteredCount: allProducts.length,
        totalInMock: totalBefore
      });
    }

    const resolved = allProducts.map((product) => ({
      ...product,
      brand_name: mockBrandMap.get(product?.brand_id) || null
    }));

    logger.info({
      message: 'BigCommerce product sync complete',
      platform: 'bigcommerce',
      storeId,
      total: resolved.length,
      durationSec: Number(((Date.now() - startTime) / 1000).toFixed(2))
    });

    return { products: resolved, brandMap: mockBrandMap };
  }

  brandsLoaded = false;
  brandMap = new Map();
  await loadBrands();

  const headers = buildHeaders();
  let currentPage = 1;
  let totalPages = null;
  const allProducts = [];

  while (true) {
    const params = {
      include: 'variants,images,custom_fields',
      limit: pageSize,
      page: currentPage
    };

    if (since) {
      params['date_modified:min'] = since.toISOString();
    }

    const response = await requestWithRetry(
      () => http.get(buildV3Url('/catalog/products'), { headers, params }),
      { storeId, page: currentPage, retryAttempts }
    );

    const items = Array.isArray(response?.data?.data) ? response.data.data : [];
    const pagination = response?.data?.meta?.pagination;
    totalPages = pagination?.total_pages ?? totalPages;

    const resolved = items.map((product) => ({
      ...product,
      brand_name: brandMap.get(product?.brand_id) || null
    }));

    allProducts.push(...resolved);
    logger.info({
      message: 'BigCommerce products page fetched',
      platform: 'bigcommerce',
      storeId,
      page: currentPage,
      count: items.length
    });

    if (items.length < pageSize || (totalPages && currentPage >= totalPages)) {
      break;
    }

    if (rateLimitDelay > 0) {
      await sleep(rateLimitDelay);
    }

    currentPage += 1;
  }

  logger.info({
    message: 'BigCommerce product sync complete',
    platform: 'bigcommerce',
    storeId,
    total: allProducts.length,
    durationSec: Number(((Date.now() - startTime) / 1000).toFixed(2))
  });

  return { products: allProducts, brandMap: new Map(brandMap) };
}

/**
 * Fetch all categories from BigCommerce with pagination.
 * @param {object|string} store
 * @returns {Promise<object[]>}
 */
async function fetchCategories(store) {
  const storeId = getStoreId(store);
  const syncConfig = getSyncConfig(store);
  const pageSize = Math.min(syncConfig.batchSize || DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const rateLimitDelay = syncConfig.rateLimitDelay || DEFAULT_RATE_LIMIT_DELAY;
  const retryAttempts = syncConfig.retryAttempts || DEFAULT_RETRY_ATTEMPTS;
  const startTime = Date.now();
  const mode = USE_MOCK ? 'mock' : 'real';

  logger.info({
    message: 'BigCommerce category sync started',
    platform: 'bigcommerce',
    storeId,
    mode
  });

  if (USE_MOCK) {
    logger.warn({
      message: 'Running in mock mode - using bigcommerce-mock.json',
      platform: 'bigcommerce',
      storeId
    });

    const mock = require('../mock-data/bigcommerce-mock.json');
    const treeId = mock?.[0]?.categoryTreeAPI?.tree_id ?? 1;
    const categories = mock?.[0]?.categoryTreeAPI?.data || [];

    const resolved = categories.map((category) => ({
      ...category,
      tree_id: treeId
    }));

    logger.info({
      message: 'BigCommerce category sync complete',
      platform: 'bigcommerce',
      storeId,
      total: resolved.length,
      durationSec: Number(((Date.now() - startTime) / 1000).toFixed(2))
    });

    return resolved;
  }

  const headers = buildHeaders();
  const treeId = store?.metaData?.treeId || store?.metaData?.tree_id || 1;
  let currentPage = 1;
  let totalPages = null;
  const allCategories = [];

  while (true) {
    const params = { limit: pageSize, page: currentPage };
    const response = await requestWithRetry(
      () => http.get(buildV3Url('/catalog/categories'), { headers, params }),
      { storeId, page: currentPage, retryAttempts }
    );

    const items = Array.isArray(response?.data?.data) ? response.data.data : [];
    const pagination = response?.data?.meta?.pagination;
    totalPages = pagination?.total_pages ?? totalPages;

    const resolved = items.map((category) => ({
      ...category,
      tree_id: treeId
    }));

    allCategories.push(...resolved);
    logger.info({
      message: 'BigCommerce categories page fetched',
      platform: 'bigcommerce',
      storeId,
      page: currentPage,
      count: items.length
    });

    if (items.length < pageSize || (totalPages && currentPage >= totalPages)) {
      break;
    }

    if (rateLimitDelay > 0) {
      await sleep(rateLimitDelay);
    }

    currentPage += 1;
  }

  logger.info({
    message: 'BigCommerce category sync complete',
    platform: 'bigcommerce',
    storeId,
    total: allCategories.length,
    durationSec: Number(((Date.now() - startTime) / 1000).toFixed(2))
  });

  return allCategories;
}

module.exports = {
  fetchProducts,
  fetchCategories,
  buildHeaders,
  buildV3Url,
  buildV2Url
};