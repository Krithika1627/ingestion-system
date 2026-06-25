const express = require('express');
const mongoose = require('mongoose');
const logger = require('../services/logger.service');
const productApi = require('../services/product-api.service');
const offerApi = require('../services/offer-api.service');
const searchApi = require('../services/search-api.service');
const aiApi = require('../services/ai-api.service');
const { get, set, buildKey, shortCache, longCache } = require('../services/cache.service');
const { connectDB } = require('../services/db.service');

const router = express.Router();

router.get('/products/:id', async (req, res, next) => {
  const startTime = Date.now();
  const { id } = req.params;

  const cacheKey = buildKey('/ai/products/' + id, {});
  const cached = get(shortCache, cacheKey);
  if (cached) return res.json(cached);

  try {
    if (!id || typeof id !== 'string' || !id.startsWith('cprod_')) {
      res.status(400).json({
        success: false,
        error: 'Invalid param: product ID must start with cprod_',
        code: 400
      });
      return;
    }

    const product = await productApi.getProductById(id);

    if (!product) {
      res.status(404).json({
        success: false,
        error: 'Product not found',
        code: 404
      });
      return;
    }

    const offersResult = await offerApi.getOffersByProduct(id);
    const offers = offersResult ? offersResult.offers : [];

    const aiFormatted = aiApi.formatProductForAI(product, offers);

    aiApi.validateAIResponse(aiFormatted, '/ai/products/:id');

    const responseTime = Date.now() - startTime;

    logger.info({
      message: 'AI product fetched',
      method: 'GET',
      path: '/ai/products/:id',
      productId: id,
      responseTimeMs: responseTime
    });

    const response = {
      success: true,
      data: aiFormatted
    };

    set(shortCache, cacheKey, response);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/search', async (req, res, next) => {
  const startTime = Date.now();

  try {
    const rawQ = req.query.q;

    if (!rawQ || typeof rawQ !== 'string' || rawQ.trim().length < 1) {
      res.status(400).json({
        success: false,
        error: "Search query 'q' is required",
        code: 400
      });
      return;
    }

    let page = 1;
    if (req.query.page !== undefined && req.query.page !== null) {
      page = Number(req.query.page);
      if (!Number.isInteger(page) || page < 1) page = 1;
    }

    let limit = 20;
    if (req.query.limit !== undefined && req.query.limit !== null) {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) limit = 20;
    }

    const result = await searchApi.searchProducts({
      q: rawQ.trim(),
      filters: {
        category: req.query.category || null,
        brand: req.query.brand || null,
        platform: req.query.platform || null,
        min_price: req.query.min_price !== undefined ? Number(req.query.min_price) : null,
        max_price: req.query.max_price !== undefined ? Number(req.query.max_price) : null,
        availability: req.query.availability || null
      },
      sort: 'relevance',
      page,
      limit
    });

    const products = result.data || [];
    const total = result.total || 0;

    let aiResults;
    if (products.length > 0 && products.length <= 5) {
      aiResults = await Promise.all(
        products.map(async (product) => {
          try {
            const offersResult = await offerApi.getOffersByProduct(
              product.canonicalProductId
            );
            const offers = offersResult ? offersResult.offers : [];
            return aiApi.formatProductForAI(product, offers);
          } catch (_err) {
            return aiApi.formatProductForAI(product, []);
          }
        })
      );
    } else {
      aiResults = products.map((product) => aiApi.formatProductForAI(product, []));
    }

    const context = aiApi.buildSearchContext(rawQ.trim(), aiResults, total);

    const responseTime = Date.now() - startTime;

    logger.info({
      message: 'AI search executed',
      method: 'GET',
      path: '/ai/search',
      query: rawQ.trim(),
      resultCount: aiResults.length,
      total,
      responseTimeMs: responseTime
    });

    res.json({
      success: true,
      data: {
        query: rawQ.trim(),
        results: aiResults,
        context
      },
      meta: {
        page: result.page || page,
        total,
        hasMore: result.hasMore !== undefined ? result.hasMore : false
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/catalog', async (req, res, next) => {
  const startTime = Date.now();

  const cacheKey = buildKey('/ai/catalog', { page: req.query.page, limit: req.query.limit });
  const cached = get(longCache, cacheKey);
  if (cached) return res.json(cached);

  try {
    let page = 1;
    if (req.query.page !== undefined && req.query.page !== null) {
      page = Number(req.query.page);
      if (!Number.isInteger(page) || page < 1) page = 1;
    }

    let limit = 50;
    if (req.query.limit !== undefined && req.query.limit !== null) {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) limit = 50;
    }

    await connectDB();
    const collection = mongoose.connection.collection('canonical_products');
    const skip = (page - 1) * limit;
    const total = await collection.countDocuments();

    const docs = await collection
      .find({})
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const items = docs.map(aiApi.formatCatalogItem).filter(Boolean);

    const responseTime = Date.now() - startTime;

    logger.info({
      message: 'AI catalog fetched',
      method: 'GET',
      path: '/ai/catalog',
      page,
      limit,
      total,
      responseTimeMs: responseTime
    });

    const response = {
      success: true,
      data: {
        items,
        generatedAt: new Date().toISOString()
      },
      meta: {
        page,
        limit,
        total,
        hasMore: skip + limit < total
      }
    };

    set(longCache, cacheKey, response);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
