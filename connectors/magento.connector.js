const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../services/logger.service');

const http = axios.create({ timeout: 30000 });

const USE_MOCK = process.env.MAGENTO_USE_MOCK === 'true';
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_RATE_LIMIT_DELAY = 1000;
const DEFAULT_RETRY_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStoreId(store) {
  if (typeof store === 'string') {
    return store;
  }
  return store?.id || store?.storeId || 'store_magento_001';
}

function getSyncConfig(store) {
  return store?.syncConfig || {};
}

function getBaseUrl() {
  const storeUrl = process.env.MAGENTO_STORE_URL;
  if (!storeUrl) {
    throw new Error('MAGENTO_STORE_URL is not configured');
  }
  return `${storeUrl.replace(/\/$/, '')}/rest/V1`;
}

function getHeaders() {
  const token = process.env.MAGENTO_ACCESS_TOKEN;
  if (!token) {
    throw new Error('MAGENTO_ACCESS_TOKEN is not configured');
  }
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

function loadMockData() {
  const mockPath = path.join(__dirname, '..', 'mock-data', 'magento-mock.json');
  const raw = fs.readFileSync(mockPath, 'utf-8');
  return JSON.parse(raw);
}

async function requestWithRetry(requestFn, context) {
  const retryAttempts = context?.retryAttempts || DEFAULT_RETRY_ATTEMPTS;

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      return await requestFn();
    } catch (error) {
      if (attempt === retryAttempts) {
        logger.error({
          message: 'Magento request failed',
          platform: 'magento',
          attempt,
          error: error?.message || String(error),
          ...context
        });
        throw error;
      }

      const waitMs = 1000 * 2 ** (attempt - 1);
      logger.warn({
        message: 'Retrying Magento request',
        platform: 'magento',
        attempt,
        waitMs,
        error: error?.message || String(error),
        ...context
      });
      await sleep(waitMs);
    }
  }

  throw new Error('Magento request failed after retries');
}

async function fetchProducts(store, since) {
  const storeId = getStoreId(store);
  const syncConfig = getSyncConfig(store);
  const pageSize = syncConfig.batchSize || DEFAULT_PAGE_SIZE;
  const rateLimitDelay = syncConfig.rateLimitDelay || DEFAULT_RATE_LIMIT_DELAY;
  const startTime = Date.now();
  const mode = USE_MOCK ? 'mock' : 'real';

  logger.info({
    message: 'Magento product sync started',
    platform: 'magento',
    storeId,
    mode
  });

  if (USE_MOCK) {
    logger.warn({
      message: 'Running in mock mode — using magento-mock.json',
      platform: 'magento',
      storeId
    });
    const mock = loadMockData();
    let items = mock?.products?.items || [];

    if (since) {
      const sinceTime = new Date(since).getTime();
      items = items.filter((item) => {
        const updated = item?.updated_at ? new Date(item.updated_at).getTime() : 0;
        return updated >= sinceTime;
      });
      logger.info({
        message: 'Magento mock incremental filter applied',
        platform: 'magento',
        storeId,
        since: since.toISOString(),
        filteredCount: items.length,
        totalInMock: (mock?.products?.items || []).length
      });
    }

    logger.info({
      message: 'Magento product sync complete',
      platform: 'magento',
      storeId,
      total: items.length,
      durationSec: Number(((Date.now() - startTime) / 1000).toFixed(2))
    });
    return items;
  }

  const baseUrl = getBaseUrl();
  const headers = getHeaders();
  let currentPage = 1;
  let totalCount = null;
  const allItems = [];
  const retryAttempts = syncConfig.retryAttempts || DEFAULT_RETRY_ATTEMPTS;

  while (true) {
    const params = new URLSearchParams();
    params.append('searchCriteria[pageSize]', String(pageSize));
    params.append('searchCriteria[currentPage]', String(currentPage));

    if (since) {
      params.append('searchCriteria[filter_groups][0][filters][0][field]', 'updated_at');
      params.append('searchCriteria[filter_groups][0][filters][0][value]', since.toISOString());
      params.append('searchCriteria[filter_groups][0][filters][0][condition_type]', 'gteq');
    }

    const data = await requestWithRetry(
      async () => {
        const response = await http.get(`${baseUrl}/products`, {
          headers,
          params
        });
        return response.data;
      },
      { storeId, currentPage, retryAttempts }
    );

    const items = Array.isArray(data?.items) ? data.items : [];
    if (typeof data?.total_count === 'number') {
      totalCount = data.total_count;
    }

    allItems.push(...items);
    logger.info({
      message: 'Magento products page fetched',
      platform: 'magento',
      storeId,
      page: currentPage,
      count: items.length
    });

    if (items.length < pageSize) {
      break;
    }

    if (typeof totalCount === 'number' && currentPage * pageSize >= totalCount) {
      break;
    }

    if (rateLimitDelay > 0) {
      logger.info({
        message: 'Magento rate limit delay',
        platform: 'magento',
        storeId,
        delayMs: rateLimitDelay
      });
      await sleep(rateLimitDelay);
    }

    currentPage += 1;
  }

  logger.info({
    message: 'Magento product sync complete',
    platform: 'magento',
    storeId,
    total: allItems.length,
    durationSec: Number(((Date.now() - startTime) / 1000).toFixed(2))
  });

  return allItems;
}

async function fetchCategories(store) {
  const storeId = getStoreId(store);
  const mode = USE_MOCK ? 'mock' : 'real';
  const startTime = Date.now();

  logger.info({
    message: 'Magento category sync started',
    platform: 'magento',
    storeId,
    mode
  });

  if (USE_MOCK) {
    logger.warn({
      message: 'Running in mock mode — using magento-mock.json',
      platform: 'magento',
      storeId
    });
    const mock = loadMockData();
    const categories = mock?.categories || null;
    logger.info({
      message: 'Magento category sync complete',
      platform: 'magento',
      storeId,
      durationSec: Number(((Date.now() - startTime) / 1000).toFixed(2))
    });
    return categories;
  }

  const baseUrl = getBaseUrl();
  const headers = getHeaders();
  const retryAttempts = getSyncConfig(store).retryAttempts || DEFAULT_RETRY_ATTEMPTS;

  const data = await requestWithRetry(
    async () => {
      const response = await http.get(`${baseUrl}/categories`, { headers });
      return response.data;
    },
    { storeId, retryAttempts }
  );

  logger.info({
    message: 'Magento category sync complete',
    platform: 'magento',
    storeId,
    durationSec: Number(((Date.now() - startTime) / 1000).toFixed(2))
  });

  return data;
}

module.exports = { fetchProducts, fetchCategories };