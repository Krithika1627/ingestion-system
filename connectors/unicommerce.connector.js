const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../services/logger.service');

const http = axios.create({ timeout: 30000 });

const USE_MOCK = process.env.UNICOMMERCE_USE_MOCK === 'true';
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_RATE_LIMIT_DELAY = 500;
const DEFAULT_RETRY_ATTEMPTS = 3;
const RETRY_STATUSES = new Set([429, 500, 502, 503]);

let accessToken = null;
let tokenExpiresAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStoreId(store) {
  if (typeof store === 'string') {
    return store;
  }
  return store?.id || store?.storeId || 'store_unicommerce_001';
}

function getSyncConfig(store) {
  return store?.syncConfig || {};
}

function loadMockData() {
  const mockPath = path.join(__dirname, '..', 'mock-data', 'unicommerce-mock.json');
  const raw = fs.readFileSync(mockPath, 'utf-8');
  return JSON.parse(raw);
}

function getBaseUrl() {
  const baseUrl = process.env.UNICOMMERCE_BASE_URL;
  if (!baseUrl) {
    throw new Error('UNICOMMERCE_BASE_URL is not configured');
  }
  return baseUrl.replace(/\/$/, '');
}

async function authenticate() {
  const baseUrl = getBaseUrl();
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', process.env.UNICOMMERCE_CLIENT_ID || '');
  params.append('client_secret', process.env.UNICOMMERCE_CLIENT_SECRET || '');
  params.append('username', process.env.UNICOMMERCE_USERNAME || '');
  params.append('password', process.env.UNICOMMERCE_PASSWORD || '');

  const response = await http.post(`${baseUrl}/oauth/token`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  const token = response?.data?.access_token;
  const expiresIn = Number(response?.data?.expires_in || 0);
  accessToken = token || null;
  tokenExpiresAt = expiresIn ? Date.now() + (expiresIn - 60) * 1000 : Date.now() + 10 * 60 * 1000;

  if (!accessToken) {
    throw new Error('Unicommerce authentication failed');
  }

  return accessToken;
}

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt) {
    return accessToken;
  }
  return authenticate();
}

async function requestWithRetry(requestFn, context) {
  const retryAttempts = context?.retryAttempts || DEFAULT_RETRY_ATTEMPTS;

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      return await requestFn();
    } catch (error) {
      const status = error?.response?.status;
      const isRetriable = status ? RETRY_STATUSES.has(status) : true;

      if (status === 401 && attempt < retryAttempts) {
        accessToken = null;
        tokenExpiresAt = 0;
      } else if (!isRetriable || attempt === retryAttempts) {
        logger.error({
          message: 'Unicommerce request failed',
          platform: 'unicommerce',
          attempt,
          status: status || 'network',
          error: error?.message || String(error),
          ...context
        });
        throw error;
      }

      const waitMs = 1000 * 2 ** (attempt - 1);
      logger.warn({
        message: 'Retrying Unicommerce request',
        platform: 'unicommerce',
        attempt,
        waitMs,
        status: status || 'network',
        error: error?.message || String(error),
        ...context
      });
      await sleep(waitMs);
    }
  }

  throw new Error('Unicommerce request failed after retries');
}

async function fetchInventorySnapshots(store, facilityCode, since) {
  const storeId = getStoreId(store);
  const syncConfig = getSyncConfig(store);
  const pageSize = syncConfig.batchSize || DEFAULT_PAGE_SIZE;
  const rateLimitDelay = syncConfig.rateLimitDelay || DEFAULT_RATE_LIMIT_DELAY;
  const retryAttempts = syncConfig.retryAttempts || DEFAULT_RETRY_ATTEMPTS;
  const startTime = Date.now();
  const mode = USE_MOCK ? 'mock' : 'real';

  if (since) {
    logger.info({
      message: 'Unicommerce does not support server-side delta filtering, running full fetch with in-memory filter',
      platform: 'unicommerce',
      storeId,
      since: since.toISOString()
    });
  }

  const resolvedFacility =
    facilityCode || store?.metaData?.facilityCode || process.env.UNICOMMERCE_FACILITY_CODE || null;

  logger.info({
    message: 'Unicommerce inventory sync started',
    platform: 'unicommerce',
    storeId,
    facilityCode: resolvedFacility,
    mode
  });

  if (USE_MOCK) {
    logger.warn({
      message: 'Running in mock mode — using unicommerce-mock.json',
      platform: 'unicommerce',
      storeId
    });
    const mock = loadMockData();
    const snapshots = mock
      .flatMap((entry) => entry?.inventoryAPI?.inventorySnapshots || [])
      .filter(Boolean);
    logger.info({
      message: 'Unicommerce inventory sync complete',
      platform: 'unicommerce',
      storeId,
      total: snapshots.length,
      durationSec: Number(((Date.now() - startTime) / 1000).toFixed(2))
    });
    return snapshots;
  }

  const baseUrl = getBaseUrl();
  const allSnapshots = [];
  let pageNumber = 0;

  while (true) {
    const token = await getAccessToken();
    const url = `${baseUrl}/services/rest/v1/inventory/inventorySnapshot/list`;
    const params = {
      facilityCode: resolvedFacility,
      pageNumber,
      pageSize
    };

    const data = await requestWithRetry(
      () =>
        http.get(url, {
          headers: { Authorization: `Bearer ${token}` },
          params
        }),
      { storeId, pageNumber, retryAttempts }
    );

    const snapshots = Array.isArray(data?.data) ? data.data : data?.data?.inventorySnapshots || [];
    const pageItems = Array.isArray(snapshots) ? snapshots : [];
    allSnapshots.push(...pageItems);

    logger.info({
      message: 'Unicommerce inventory page fetched',
      platform: 'unicommerce',
      storeId,
      facilityCode: resolvedFacility,
      pageNumber,
      count: pageItems.length
    });

    if (pageItems.length === 0 || pageItems.length < pageSize) {
      break;
    }

    if (rateLimitDelay > 0) {
      await sleep(rateLimitDelay);
    }

    pageNumber += 1;
  }

  let resultSnapshots = allSnapshots;

  if (since) {
    const sinceTime = new Date(since).getTime();
    const totalBefore = resultSnapshots.length;
    resultSnapshots = resultSnapshots.filter((snapshot) => {
      const updated = snapshot?.updatedAt
        ? new Date(snapshot.updatedAt).getTime()
        : snapshot?.inventorySnapshotDate
          ? new Date(snapshot.inventorySnapshotDate).getTime()
          : 0;
      return updated >= sinceTime;
    });
    logger.info({
      message: 'Unicommerce in-memory incremental filter applied',
      platform: 'unicommerce',
      storeId,
      since: since.toISOString(),
      filteredCount: resultSnapshots.length,
      totalBefore
    });
  }

  logger.info({
    message: 'Unicommerce inventory sync complete',
    platform: 'unicommerce',
    storeId,
    total: resultSnapshots.length,
    durationSec: Number(((Date.now() - startTime) / 1000).toFixed(2))
  });

  return resultSnapshots;
}

module.exports = { fetchInventorySnapshots };