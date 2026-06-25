const mongoose = require('mongoose');
const logger = require('./logger.service');
const { connectDB, getCollection } = require('./db.service');
const { SyncMetric } = require('../models/sync_metric.model');
const { ApiMetric } = require('../models/api_metric.model');
const { FailedJob } = require('../models/failed_job.model');
const { DataQualityIssue } = require('../models/data_quality_issue.model');

async function recordSyncMetric(data) {
  try {
    await connectDB();
    const doc = await SyncMetric.create({
      storeId: data.storeId,
      platform: data.platform,
      syncType: data.syncType,
      status: data.status,
      totalProducts: data.totalProducts || 0,
      successProducts: data.successProducts || 0,
      failedProducts: data.failedProducts || 0,
      durationMs: data.durationMs || 0,
      syncedAt: new Date(),
      isFullSync: data.isFullSync || false,
      errorMessage: data.errorMessage || null
    });

    logger.info({
      message: 'Sync metric recorded',
      storeId: data.storeId,
      platform: data.platform,
      status: data.status,
      durationMs: data.durationMs
    });

    return doc;
  } catch (error) {
    logger.error({
      message: 'Failed to record sync metric',
      service: 'metrics',
      storeId: data.storeId,
      error: error?.message || String(error)
    });
    throw error;
  }
}

async function getIngestionMetrics() {
  await connectDB();

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [aggregated, byPlatformRaw] = await Promise.all([
    SyncMetric.aggregate([
      { $match: { syncedAt: { $gte: twentyFourHoursAgo } } },
      {
        $group: {
          _id: null,
          totalProductsToday: { $sum: '$successProducts' },
          totalSyncsToday: { $sum: 1 },
          successfulSyncsToday: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          },
          failedSyncsLast24h: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          },
          partialSyncsLast24h: {
            $sum: { $cond: [{ $eq: ['$status', 'partial'] }, 1, 0] }
          },
          totalDurationMs: { $sum: '$durationMs' }
        }
      }
    ]),
    SyncMetric.aggregate([
      { $match: { syncedAt: { $gte: twentyFourHoursAgo } } },
      {
        $group: {
          _id: '$platform',
          syncs: { $sum: 1 },
          totalDurationMs: { $sum: '$durationMs' },
          successfulSyncs: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          }
        }
      }
    ])
  ]);

  const totals = aggregated[0] || {
    totalProductsToday: 0,
    totalSyncsToday: 0,
    successfulSyncsToday: 0,
    failedSyncsLast24h: 0,
    partialSyncsLast24h: 0,
    totalDurationMs: 0
  };

  const totalSyncs = totals.totalSyncsToday || 0;
  const successRate =
    totalSyncs > 0
      ? ((totals.successfulSyncsToday / totalSyncs) * 100).toFixed(1) + '%'
      : '0.0%';

  const avgSyncDurationMs =
    totalSyncs > 0 ? Math.round(totals.totalDurationMs / totalSyncs) : 0;

  const byPlatform = {};
  for (const entry of byPlatformRaw) {
    const pSyncs = entry.syncs || 0;
    byPlatform[entry._id] = {
      syncs: pSyncs,
      avgDurationMs: pSyncs > 0 ? Math.round(entry.totalDurationMs / pSyncs) : 0,
      successRate:
        pSyncs > 0
          ? ((entry.successfulSyncs / pSyncs) * 100).toFixed(1) + '%'
          : '0.0%'
    };
  }

  return {
    totalProductsToday: totals.totalProductsToday,
    totalSyncsToday: totals.totalSyncsToday,
    successfulSyncsToday: totals.successfulSyncsToday,
    failedSyncsLast24h: totals.failedSyncsLast24h,
    partialSyncsLast24h: totals.partialSyncsLast24h,
    syncSuccessRate: successRate,
    avgSyncDurationMs,
    byPlatform
  };
}

async function recordApiMetric(endpoint, durationMs, isError) {
  const hour = new Date(Math.floor(Date.now() / 3600000) * 3600000);

  try {
    await connectDB();
    const doc = await ApiMetric.findOneAndUpdate(
      { endpoint, hour },
      {
        $inc: {
          requestCount: 1,
          errorCount: isError ? 1 : 0,
          totalResponseTimeMs: durationMs
        }
      },
      { upsert: true, new: true }
    );

    doc.avgResponseTimeMs =
      doc.requestCount > 0
        ? Math.round(doc.totalResponseTimeMs / doc.requestCount)
        : 0;

    await doc.save();
  } catch (error) {
    logger.warn({
      message: 'Failed to record API metric',
      service: 'metrics',
      endpoint,
      error: error?.message || String(error)
    });
  }
}

async function getApiMetrics() {
  await connectDB();

  const now = Date.now();
  const oneHourAgo = new Date(Math.floor((now - 3600000) / 3600000) * 3600000);
  const twentyFourHoursAgo = new Date(Math.floor((now - 86400000) / 3600000) * 3600000);

  const [lastHourDocs, last24hDocs] = await Promise.all([
    ApiMetric.find({ hour: { $gte: oneHourAgo } }).lean(),
    ApiMetric.find({ hour: { $gte: twentyFourHoursAgo } }).lean()
  ]);

  const lastHourTotalRequests = lastHourDocs.reduce(
    (sum, d) => sum + (d.requestCount || 0),
    0
  );
  const lastHourTotalErrors = lastHourDocs.reduce(
    (sum, d) => sum + (d.errorCount || 0),
    0
  );

  const lastHourErrorRate =
    lastHourTotalRequests > 0
      ? ((lastHourTotalErrors / lastHourTotalRequests) * 100).toFixed(1) + '%'
      : '0.0%';

  const lastHourWeightedMs = lastHourDocs.reduce(
    (sum, d) => sum + (d.totalResponseTimeMs || 0),
    0
  );
  const lastHourAvgMs =
    lastHourTotalRequests > 0
      ? Math.round(lastHourWeightedMs / lastHourTotalRequests)
      : 0;

  const byEndpoint = lastHourDocs
    .map((d) => ({
      endpoint: d.endpoint,
      requests: d.requestCount || 0,
      errors: d.errorCount || 0,
      avgMs: d.avgResponseTimeMs || 0
    }))
    .sort((a, b) => b.requests - a.requests);

  // --- last24h ---
  const last24hTotalRequests = last24hDocs.reduce(
    (sum, d) => sum + (d.requestCount || 0),
    0
  );
  const last24hTotalErrors = last24hDocs.reduce(
    (sum, d) => sum + (d.errorCount || 0),
    0
  );

  const last24hErrorRate =
    last24hTotalRequests > 0
      ? ((last24hTotalErrors / last24hTotalRequests) * 100).toFixed(1) + '%'
      : '0.0%';

  const last24hWeightedMs = last24hDocs.reduce(
    (sum, d) => sum + (d.totalResponseTimeMs || 0),
    0
  );
  const last24hAvgMs =
    last24hTotalRequests > 0
      ? Math.round(last24hWeightedMs / last24hTotalRequests)
      : 0;

  const endpointMap = {};
  for (const d of last24hDocs) {
    if (!endpointMap[d.endpoint]) {
      endpointMap[d.endpoint] = {
        endpoint: d.endpoint,
        totalMs: 0,
        count: 0
      };
    }
    endpointMap[d.endpoint].totalMs += d.totalResponseTimeMs || 0;
    endpointMap[d.endpoint].count += d.requestCount || 0;
  }

  const slowestEndpoints = Object.values(endpointMap)
    .map((e) => ({
      endpoint: e.endpoint,
      avgResponseTimeMs: e.count > 0 ? Math.round(e.totalMs / e.count) : 0,
      totalRequests: e.count
    }))
    .sort((a, b) => b.avgResponseTimeMs - a.avgResponseTimeMs)
    .slice(0, 3);

  return {
    lastHour: {
      totalRequests: lastHourTotalRequests,
      totalErrors: lastHourTotalErrors,
      errorRate: lastHourErrorRate,
      avgResponseTimeMs: lastHourAvgMs,
      byEndpoint
    },
    last24h: {
      totalRequests: last24hTotalRequests,
      totalErrors: last24hTotalErrors,
      errorRate: last24hErrorRate,
      avgResponseTimeMs: last24hAvgMs,
      slowestEndpoints
    }
  };
}

async function getStoreMetrics() {
  await connectDB();

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const storesCollection = getCollection('stores');

  const allStores = await storesCollection.find({}).toArray();

  const totalStores = allStores.length;
  const activeStores = allStores.filter(
    (s) => s.lastSyncStatus === 'success'
  ).length;

  const storesWithRecentFailures = allStores
    .filter(
      (s) =>
        s.lastSyncStatus === 'failed' || s.lastSyncStatus === 'partial'
    )
    .map((s) => s.id);

  const storesSyncedToday = allStores.filter((s) => {
    if (!s.lastSyncedAt) return false;
    const lastSync = new Date(s.lastSyncedAt);
    return !isNaN(lastSync.getTime()) && lastSync >= twentyFourHoursAgo;
  }).length;

  const storesNeverSynced = allStores.filter(
    (s) => !s.lastSyncedAt
  ).length;

  const syncCounts = await SyncMetric.aggregate([
    { $match: { syncedAt: { $gte: twentyFourHoursAgo } } },
    {
      $group: {
        _id: '$storeId',
        syncCountToday: { $sum: 1 },
        productsIngestedToday: { $sum: '$successProducts' }
      }
    }
  ]);

  const syncCountMap = {};
  for (const entry of syncCounts) {
    syncCountMap[entry._id] = {
      syncCountToday: entry.syncCountToday,
      productsIngestedToday: entry.productsIngestedToday
    };
  }

  const perStore = allStores.map((s) => ({
    storeId: s.id,
    platform: s.platform || s.source || null,
    lastSyncedAt: s.lastSyncedAt || null,
    lastSyncStatus: s.lastSyncStatus || null,
    syncCountToday: syncCountMap[s.id]?.syncCountToday || 0,
    productsIngestedToday: syncCountMap[s.id]?.productsIngestedToday || 0
  }));

  return {
    totalStores,
    activeStores,
    storesWithRecentFailures,
    storesSyncedToday,
    storesNeverSynced,
    perStore
  };
}

async function getSystemHealth() {
  let mongodbStatus = 'disconnected';
  let pendingFailedJobs = 0;
  let openCriticalIssues = 0;

  try {
    await connectDB();
    await mongoose.connection.db.admin().ping();
    mongodbStatus = 'connected';
  } catch (error) {
    logger.error({
      message: 'MongoDB health check failed',
      service: 'metrics',
      error: error?.message || String(error)
    });
    mongodbStatus = 'disconnected';
  }

  try {
    pendingFailedJobs = await FailedJob.countDocuments({
      status: 'pending_review'
    });
  } catch (error) {
    logger.warn({
      message: 'Failed to count pending failed jobs for health check',
      service: 'metrics',
      error: error?.message || String(error)
    });
  }

  try {
    openCriticalIssues = await DataQualityIssue.countDocuments({
      resolved: false,
      severity: 'critical'
    });
  } catch (error) {
    logger.warn({
      message: 'Failed to count open critical issues for health check',
      service: 'metrics',
      error: error?.message || String(error)
    });
  }

  let status;
  if (mongodbStatus === 'disconnected') {
    status = 'unhealthy';
  } else if (pendingFailedJobs >= 5 || openCriticalIssues >= 10) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  return {
    status,
    mongodb: mongodbStatus,
    pendingFailedJobs,
    openCriticalIssues,
    uptime: Math.floor(process.uptime()),
    memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    nodeVersion: process.version,
    checkedAt: new Date().toISOString()
  };
}

module.exports = {
  recordSyncMetric,
  getIngestionMetrics,
  recordApiMetric,
  getApiMetrics,
  getStoreMetrics,
  getSystemHealth
};
