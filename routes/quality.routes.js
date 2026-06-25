const express = require('express');
const logger = require('../services/logger.service');
const dataQuality = require('../services/data-quality.service');
const { getCacheStats } = require('../services/cache.service');
const { DataQualityIssue } = require('../models/data_quality_issue.model');

const router = express.Router();

router.get('/issues', async (req, res, next) => {
  const startTime = Date.now();

  try {
    const {
      severity,
      resolved: rawResolved,
      canonicalProductId,
      page: rawPage,
      limit: rawLimit
    } = req.query;

    const filter = {};

    if (severity && ['warning', 'critical'].includes(severity)) {
      filter.severity = severity;
    }

    if (rawResolved !== undefined) {
      filter.resolved = rawResolved === 'true' || rawResolved === true;
    } else {
      filter.resolved = false;
    }

    if (canonicalProductId && typeof canonicalProductId === 'string') {
      filter.canonicalProductId = canonicalProductId;
    }

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

    let limit = 20;
    if (rawLimit !== undefined && rawLimit !== null) {
      limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        res.status(400).json({
          success: false,
          error: 'Invalid param: limit must be an integer between 1 and 100',
          code: 400
        });
        return;
      }
    }

    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      DataQualityIssue.find(filter)
        .sort({ detectedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DataQualityIssue.countDocuments(filter)
    ]);

    const responseTime = Date.now() - startTime;

    logger.info({
      message: 'Data quality issues listed',
      method: 'GET',
      path: '/quality/issues',
      query: req.query,
      responseTime,
      resultCount: docs.length,
      total
    });

    res.json({
      success: true,
      data: docs,
      meta: {
        page,
        total,
        hasMore: skip + limit < total
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/issues/summary', async (req, res, next) => {
  const startTime = Date.now();

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [totalOpen, critical, warnings, resolvedToday, topIssueAgg] = await Promise.all([
      DataQualityIssue.countDocuments({ resolved: false }),
      DataQualityIssue.countDocuments({ resolved: false, severity: 'critical' }),
      DataQualityIssue.countDocuments({ resolved: false, severity: 'warning' }),
      DataQualityIssue.countDocuments({
        resolved: true,
        resolvedAt: { $gte: todayStart }
      }),
      DataQualityIssue.aggregate([
        { $match: { resolved: false } },
        { $group: { _id: '$issueCode', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, issueCode: '$_id', count: 1 } }
      ])
    ]);

    const responseTime = Date.now() - startTime;

    logger.info({
      message: 'Data quality summary fetched',
      method: 'GET',
      path: '/quality/issues/summary',
      responseTime
    });

    res.json({
      success: true,
      data: {
        totalOpen,
        critical,
        warnings,
        resolvedToday,
        topIssues: topIssueAgg
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/validate', async (req, res, next) => {
  try {
    const { severity, limit } = req.body || {};

    const validationPromise = dataQuality.validateAllProducts({ severity, limit });

    validationPromise.then((summary) => {
      logger.info({
        message: 'Data quality validation completed in background',
        service: 'data-quality',
        ...summary
      });
    }).catch((error) => {
      logger.error({
        message: 'Data quality background validation failed',
        service: 'data-quality',
        error: error?.message || String(error)
      });
    });

    res.status(202).json({
      success: true,
      message: 'Validation started',
      code: 202
    });
  } catch (error) {
    next(error);
  }
});

router.get('/cache-stats', async (req, res, next) => {
  try {
    const stats = getCacheStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
});

router.post('/issues/:id/resolve', async (req, res, next) => {
  const startTime = Date.now();
  const { id } = req.params;

  try {
    const issue = await dataQuality.resolveIssue(id);

    if (!issue) {
      res.status(404).json({
        success: false,
        error: 'Data quality issue not found',
        code: 404
      });
      return;
    }

    const responseTime = Date.now() - startTime;

    logger.info({
      message: 'Data quality issue resolved via API',
      method: 'POST',
      path: `/quality/issues/${id}/resolve`,
      responseTime,
      issueId: id,
      canonicalProductId: issue.canonicalProductId,
      issueCode: issue.issueCode
    });

    res.json({
      success: true,
      data: issue
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
