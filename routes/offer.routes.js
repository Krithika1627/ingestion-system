const express = require('express');
const logger = require('../services/logger.service');
const offerApi = require('../services/offer-api.service');

const router = express.Router();

function validateOfferPagination(req, res, next) {
  const rawPage = req.query.page;
  const rawLimit = req.query.limit;

  let page = 1;
  if (rawPage !== undefined && rawPage !== null) {
    page = Number(rawPage);
    if (!Number.isInteger(page) || page < 1) {
      res.status(400).json({
        success: false,
        error: 'Invalid param: page must be a positive integer',
        code: 400
      });
      return;
    }
  }

  let limit = 50;
  if (rawLimit !== undefined && rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      res.status(400).json({
        success: false,
        error: 'Invalid param: limit must be an integer between 1 and 200',
        code: 400
      });
      return;
    }
  }

  req.validated = { page, limit };
  next();
}

router.get('/', validateOfferPagination, async (req, res, next) => {
  const startTime = Date.now();
  const validated = req.validated;
  const { product_id, store_id } = req.query;

  try {
    const validation = offerApi.validateOfferFilters({ product_id, store_id });

    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: validation.error,
        code: 400
      });
      return;
    }

    if (product_id) {
      const result = await offerApi.getOffersByProduct(product_id);

      const responseTime = Date.now() - startTime;

      logger.info({
        message: 'Offers fetched by product',
        method: 'GET',
        path: '/offers',
        query: req.query,
        responseTime,
        resultCount: result.offers.length,
        productId: product_id
      });

      res.json({
        success: true,
        data: {
          canonicalProductId: result.canonicalProductId,
          summary: result.summary,
          offers: result.offers
        }
      });
      return;
    }

    if (store_id) {
      const result = await offerApi.getOffersByStore(store_id, {
        page: validated.page,
        limit: validated.limit
      });

      const responseTime = Date.now() - startTime;

      logger.info({
        message: 'Offers fetched by store',
        method: 'GET',
        path: '/offers',
        query: req.query,
        responseTime,
        resultCount: result.data.length,
        total: result.total,
        storeId: store_id
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
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
