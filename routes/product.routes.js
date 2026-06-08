const express = require('express');
const logger = require('../services/logger.service');
const productApi = require('../services/product-api.service');
const { validatePagination, validateProductId } = require('../middleware/validate.middleware');

const router = express.Router();

router.get('/', validatePagination, async (req, res, next) => {
  const startTime = Date.now();
  const validated = req.validated;

  try {
    const result = await productApi.getProducts({
      page: validated.page,
      limit: validated.limit,
      sort: validated.sort,
      filters: {
        category: validated.category,
        brand: validated.brand,
        platform: validated.platform,
        availability: validated.availability,
        storeId: validated.storeId
      }
    });

    const responseTime = Date.now() - startTime;

    logger.info({
      message: 'Products listed',
      method: 'GET',
      path: '/products',
      query: req.query,
      responseTime,
      resultCount: result.data.length,
      total: result.total
    });

    res.json({
      success: true,
      data: result.data,
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

router.get('/:id', validateProductId, async (req, res, next) => {
  const startTime = Date.now();
  const { id } = req.params;

  try {
    const product = await productApi.getProductById(id);

    const responseTime = Date.now() - startTime;

    logger.info({
      message: 'Product fetched by ID',
      method: 'GET',
      path: `/products/${id}`,
      responseTime,
      found: !!product
    });

    if (!product) {
      res.status(404).json({
        success: false,
        error: 'Product not found',
        code: 404
      });
      return;
    }

    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/sources', validateProductId, async (req, res, next) => {
  const startTime = Date.now();
  const { id } = req.params;

  try {
    const sources = await productApi.getProductSources(id);

    const responseTime = Date.now() - startTime;

    logger.info({
      message: 'Product sources fetched',
      method: 'GET',
      path: `/products/${id}/sources`,
      responseTime,
      found: !!sources
    });

    if (!sources) {
      res.status(404).json({
        success: false,
        error: 'Product not found',
        code: 404
      });
      return;
    }

    res.json({
      success: true,
      data: sources
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
