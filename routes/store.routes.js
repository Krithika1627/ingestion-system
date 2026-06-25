const express = require('express');
const logger = require('../services/logger.service');
const storeApi = require('../services/store-api.service');
const { get, set, buildKey, mediumCache } = require('../services/cache.service');
const { validatePagination } = require('../middleware/validate.middleware');

const router = express.Router();

router.get('/', validatePagination, async (req, res, next) => {
  const startTime = Date.now();
  const validated = req.validated;

  const cacheKey = buildKey('/stores', validated);
  const cached = get(mediumCache, cacheKey);
  if (cached) return res.json(cached);

  try {
    const result = await storeApi.getStores({
      page: validated.page,
      limit: validated.limit
    });

    const responseTime = Date.now() - startTime;

    logger.info({
      message: 'Stores listed',
      method: 'GET',
      path: '/stores',
      query: req.query,
      responseTime,
      resultCount: result.data.length,
      total: result.total
    });

    const response = {
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        hasMore: result.hasMore
      }
    };

    set(mediumCache, cacheKey, response);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/:storeId', async (req, res, next) => {
  const startTime = Date.now();
  const { storeId } = req.params;

  const cacheKey = buildKey('/stores/' + storeId, {});
  const cached = get(mediumCache, cacheKey);
  if (cached) return res.json(cached);

  try {
    const store = await storeApi.getStoreById(storeId);

    const responseTime = Date.now() - startTime;

    logger.info({
      message: 'Store fetched by ID',
      method: 'GET',
      path: `/stores/${storeId}`,
      responseTime,
      found: !!store
    });

    if (!store) {
      res.status(404).json({
        success: false,
        error: 'Store not found',
        code: 404
      });
      return;
    }

    const response = {
      success: true,
      data: store
    };

    set(mediumCache, cacheKey, response);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/:storeId/catalog', validatePagination, async (req, res, next) => {
  const startTime = Date.now();
  const { storeId } = req.params;
  const validated = req.validated;

  try {
    /* Verify store exists first */
    const store = await storeApi.getStoreById(storeId);

    if (!store) {
      res.status(404).json({
        success: false,
        error: 'Store not found',
        code: 404
      });
      return;
    }

    const result = await storeApi.getStoreCatalog(storeId, {
      page: validated.page,
      limit: validated.limit,
      sort: validated.sort
    });

    const responseTime = Date.now() - startTime;

    logger.info({
      message: 'Store catalog fetched',
      method: 'GET',
      path: `/stores/${storeId}/catalog`,
      params: { storeId },
      query: req.query,
      responseTime,
      resultCount: result.data.length,
      total: result.total
    });

    res.json({
      success: true,
      data: {
        storeId: store.storeId,
        storeName: store.name,
        platform: store.platform,
        products: result.data
      },
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
