const express = require('express');
const {
  getSystemHealth,
  getIngestionMetrics,
  getApiMetrics,
  getStoreMetrics
} = require('../services/metrics.service');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const [system, ingestion, api, stores] = await Promise.all([
      getSystemHealth(),
      getIngestionMetrics(),
      getApiMetrics(),
      getStoreMetrics()
    ]);

    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        system,
        ingestion,
        api,
        stores
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/health', async (req, res, next) => {
  try {
    const system = await getSystemHealth();

    res.json({
      success: true,
      data: {
        status: system.status,
        mongodb: system.mongodb,
        uptime: system.uptime,
        checkedAt: system.checkedAt
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/ingestion', async (req, res, next) => {
  try {
    const ingestion = await getIngestionMetrics();

    res.json({
      success: true,
      data: ingestion
    });
  } catch (error) {
    next(error);
  }
});

router.get('/api', async (req, res, next) => {
  try {
    const api = await getApiMetrics();

    res.json({
      success: true,
      data: api
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
