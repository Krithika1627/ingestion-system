const express = require('express');
const logger = require('../services/logger.service');
const searchApi = require('../services/search-api.service');
const { validateSearchParams } = require('../middleware/validate.middleware');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  //15 minute window
  max: 100,                    //max 100 requests per IP per window
  message: {
    success: false,
    error: "Too many search requests, please try again later",
    code: 429
  },
  standardHeaders: true,
  legacyHeaders: false
});

const suggestionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  //15 minute window
  max: 50,                    //max 50 requests per IP per window
  message: {
    success: false,
    error: "Too many suggestion requests, please try again later",
    code: 429
  },
  standardHeaders: true,
  legacyHeaders: false
});

router.get('/', searchLimiter, validateSearchParams, async (req, res, next) => {
  const startTime = Date.now();
  const validated = req.validated;

  try {
    const result = await searchApi.searchProducts({
      q: validated.q,
      filters: {
        category: validated.category,
        brand: validated.brand,
        platform: validated.platform,
        min_price: validated.min_price,
        max_price: validated.max_price,
        availability: validated.availability
      },
      sort: validated.sort,
      page: validated.page,
      limit: validated.limit
    });

    const responseTime = Date.now() - startTime;

    logger.info({
      message: 'Search results returned',
      method: 'GET',
      path: '/search',
      query: req.query,
      responseTime,
      resultCount: result.data.length,
      total: result.total,
      sort: validated.sort
    });

    res.json({
      success: true,
      data: {
        query: result.query,
        results: result.data
      },
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        hasMore: result.hasMore,
        sort: validated.sort
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/suggestions', suggestionLimiter, async (req, res, next) => {
  const startTime = Date.now();
  const rawQ = req.query.q;

  if (!rawQ || typeof rawQ !== 'string' || rawQ.trim().length < 2) {
    res.status(400).json({
      success: false,
      error: "Search query 'q' is required and must be at least 2 characters",
      code: 400
    });
    return;
  }

  try {
    const result = await searchApi.getSuggestions(rawQ.trim());

    const responseTime = Date.now() - startTime;

    logger.info({
      message: 'Search suggestions returned',
      method: 'GET',
      path: '/search/suggestions',
      query: req.query,
      responseTime,
      suggestionCount: result.suggestions.length
    });

    res.json({
      success: true,
      data: {
        query: result.query,
        suggestions: result.suggestions
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
