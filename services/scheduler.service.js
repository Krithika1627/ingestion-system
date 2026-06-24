const cron = require('node-cron');
const { CronExpressionParser } = require('cron-parser');
const logger = require('./logger.service');
const { SyncConfig, DEFAULT_CRON_BY_PLATFORM } = require('../models/sync_config.model');
const { connectDB, getStoreById } = require('./db.service');
const { getSyncWindow, updateSyncTimestamp } = require('./incremental-sync.service');
const { executeWithRetry } = require('./retry.service');
const { runShopifyFullSync } = require('../pipelines/shopify.pipeline');
const { runMagentoFullSync } = require('../pipelines/magento.pipeline');
const { validateProduct } = require('./data-quality.service');
const { runWooFullSync } = require('../pipelines/woocommerce.pipeline');
const { runBigCommerceFullSync } = require('../pipelines/bigcommerce.pipeline');
const { runUnicommerceInventorySync } = require('../pipelines/unicommerce.pipeline');
const { scrapeStore } = require('./scraper/scraper.orchestrator');
const { acquireLock, releaseLock } = require('./lock.service');
const scheduleMap = new Map();
const scheduleConfigs = new Map();
const runningJobs = new Set();

function resolveCronExpression(platform, cronExpression) {
  return cronExpression || DEFAULT_CRON_BY_PLATFORM[platform] || '0 */6 * * *';
}

function resolveNextRunAt(cronExpression) {
  try {
    const interval = CronExpressionParser.parse(cronExpression);
    return interval.next().toDate();
  } catch (error) {
    console.error('cron-parser error:', error);
    return null;
  }
}

async function runPlatformSync(platform, storeId, since) {
  switch (platform) {
    case 'shopify':
      return runShopifyFullSync(storeId, since);
    case 'magento':
      return runMagentoFullSync(storeId || 'store_magento_001', since);
    case 'woocommerce':
      return runWooFullSync(storeId || 'store_woo_001', since);
    case 'bigcommerce':
      return runBigCommerceFullSync(storeId || 'store_bigcommerce_001', since);
    case 'unicommerce':
      return runUnicommerceInventorySync(storeId || 'store_unicommerce_001', null, since);
    case 'scraped': {
      if (since) {
        logger.info({
          message: 'Scraped sites do not support incremental sync, running full scrape',
          service: 'scheduler',
          platform: 'scraped',
          storeId
        });
      }
      const store = await getStoreById(storeId);
      const storeUrl = store?.credentials?.storeUrl || store?.domain || null;
      if (!storeUrl) {
        throw new Error('Scraped store URL not found');
      }
      return scrapeStore(storeUrl, { storeId });
    }
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

async function updateRunTimestamps(config, nextRunAt, lastRunAt) {
  try {
    await SyncConfig.updateOne(
      { _id: config._id },
      { $set: { lastRunAt, nextRunAt } }
    );
  } catch (error) {
    logger.warn({
      message: 'Failed to update scheduler run timestamps',
      service: 'scheduler',
      storeId: config.storeId,
      platform: config.platform,
      error: error?.message || String(error)
    });
  }
}

async function registerJob(config) {
  if (!config?.storeId || !config?.platform) {
    return null;
  }

  if (!cron.validate(config.cronExpression)) {
    throw new Error('Invalid cron expression');
  }

  const existingTask = scheduleMap.get(config.storeId);
  if (existingTask) {
    existingTask.stop();
    scheduleMap.delete(config.storeId);
  }

  const task = cron.schedule(config.cronExpression, async () => {
    const startedAt = new Date();

    const lockAcquired =
      await acquireLock(config.storeId);

    if (!lockAcquired) {
      logger.info({
        message: 'Store sync already running',
        service: 'scheduler',
        storeId: config.storeId,
        platform: config.platform
      });

      return;
    }

    runningJobs.add(config.storeId);
    logger.info({
      message: 'Scheduler job started',
      service: 'scheduler',
      storeId: config.storeId,
      platform: config.platform
    });

    try {
      const syncWindow = await getSyncWindow(config.storeId);
      if (syncWindow?.since) {
        syncWindow.since = new Date(syncWindow.since);
      }
      logger.info({
        message: 'Sync window resolved for scheduler job',
        service: 'scheduler',
        storeId: config.storeId,
        platform: config.platform,
        isFullSync: syncWindow.isFullSync,
        since: syncWindow.since ? syncWindow.since.toISOString() : null
      });

      const syncFn = (storeId, window) =>
        runPlatformSync(config.platform, storeId, window.since);

      const result = await executeWithRetry(config, syncFn, syncWindow);

      if (result.success) {
        await updateSyncTimestamp(config.storeId, 'success', result.result);

        /* Run data quality validation for synced products (fire-and-forget) */
        runDataQualityCheck(result.result);

        logger.info({
          message: 'Scheduler job finished',
          service: 'scheduler',
          storeId: config.storeId,
          platform: config.platform,
          outcome: 'success',
          attempts: result.attempts
        });
      } else {
        await updateSyncTimestamp(config.storeId, 'failed', null);
        logger.warn({
          message: 'Scheduler job dead-lettered',
          service: 'scheduler',
          storeId: config.storeId,
          platform: config.platform,
          outcome: 'failed',
          attempts: result.attempts
        });
      }
    } catch (error) {
      await updateSyncTimestamp(config.storeId, 'failed', null);
      logger.warn({
        message: 'Scheduler job failed unexpectedly',
        service: 'scheduler',
        storeId: config.storeId,
        platform: config.platform,
        error: error?.message || String(error)
      });
    } finally {
      runningJobs.delete(config.storeId);
      await releaseLock(config.storeId);
      const nextRunAt = resolveNextRunAt(config.cronExpression);
      await updateRunTimestamps(config, nextRunAt, startedAt);
    }
  });

  scheduleMap.set(config.storeId, task);
  scheduleConfigs.set(config.storeId, config);

  const nextRunAt = resolveNextRunAt(config.cronExpression);
  if (nextRunAt) {
    await updateRunTimestamps(config, nextRunAt, config.lastRunAt || null);
  }

  return task;
}

async function loadSchedules() {
  await connectDB();

  const configs = await SyncConfig.find({ isActive: true }).lean();
  for (const config of configs) {
    try {
      await registerJob(config);
    } catch (error) {
      logger.warn({
        message: 'Failed to register scheduler job',
        service: 'scheduler',
        storeId: config.storeId,
        platform: config.platform,
        error: error?.message || String(error)
      });
    }
  }

  return configs.length;
}

async function addSchedule(storeId, platform, cronExpression) {
  await connectDB();

  const resolvedCron = resolveCronExpression(platform, cronExpression);
  if (!cron.validate(resolvedCron)) {
    throw new Error('Invalid cron expression');
  }

  const existing = await SyncConfig.findOne({ storeId });
  const config = existing
    ? Object.assign(existing, { platform, cronExpression: resolvedCron, isActive: true })
    : new SyncConfig({ storeId, platform, cronExpression: resolvedCron, isActive: true });

  const saved = await config.save();
  await registerJob(saved.toObject());
  return saved;
}

async function removeSchedule(storeId) {
  const existingTask = scheduleMap.get(storeId);
  if (existingTask) {
    existingTask.stop();
    scheduleMap.delete(storeId);
  }
  scheduleConfigs.delete(storeId);
  runningJobs.delete(storeId);

  await connectDB();
  await SyncConfig.updateOne(
    { storeId },
    { $set: { isActive: false, nextRunAt: null } }
  );
}

async function updateSchedule(storeId, cronExpression) {
  await connectDB();

  if (!cron.validate(cronExpression)) {
    throw new Error('Invalid cron expression');
  }

  const config = await SyncConfig.findOne({ storeId });
  if (!config) {
    throw new Error('Schedule not found');
  }

  config.cronExpression = cronExpression;
  config.isActive = true;
  const saved = await config.save();

  await registerJob(saved.toObject());
  return saved;
}

async function triggerSync(storeId, options = {}) {
  const lockAcquired = await acquireLock(storeId);

  if (!lockAcquired) {
    throw new Error(`Store ${storeId} is already syncing`);
  }
  
  try {
    const config = scheduleConfigs.get(storeId);
    if (!config) {
      throw new Error(`No schedule found for store: ${storeId}`);
    }

    const force = options?.force === true;
    let since = null;
    let isFullSync = true;

    if (!force) {
      const window = await getSyncWindow(storeId);
      since = window.since;
      isFullSync = window.isFullSync;
    }

    logger.info({
      message: 'Manual sync triggered',
      service: 'scheduler',
      storeId,
      platform: config.platform,
      isFullSync,
      force,
      since: since ? since.toISOString() : null
    });

    const syncResult = await runPlatformSync(
      config.platform,
      storeId,
      since
    );

    await updateSyncTimestamp(
      storeId,
      'success',
      syncResult
    );

    /* Run data quality validation for synced products (fire-and-forget) */
    runDataQualityCheck(syncResult);

    return {
      success: true,
      isFullSync,
      platform: config.platform,
      storeId
    };
  } catch (error) {
    await updateSyncTimestamp(
      storeId,
      'failed',
      null
    );

    throw error;
  } finally {
    await releaseLock(storeId);
  }
}

/**
 * Extract synced canonical product IDs from a pipeline result.
 * Pipeline results have different shapes depending on the platform:
 * - Full sync: { categorySummary, productSummary } where productSummary has syncedCanonicalIds
 * - Inventory sync: flat summary without canonical IDs
 */
function extractSyncedCanonicalIds(result) {
  if (!result) return [];

  /* Full sync pattern: { categorySummary, productSummary } */
  if (result.productSummary && Array.isArray(result.productSummary.syncedCanonicalIds)) {
    return result.productSummary.syncedCanonicalIds;
  }

  /* Direct product pipeline summary */
  if (Array.isArray(result.syncedCanonicalIds)) {
    return result.syncedCanonicalIds;
  }

  return [];
}

/**
 * Run data quality validation for products that were just synced.
 */
async function runDataQualityCheck(result) {
  const canonicalIds = extractSyncedCanonicalIds(result);

  if (canonicalIds.length === 0) {
    return;
  }

  logger.info({
    message: 'Starting data quality validation for synced products',
    service: 'scheduler',
    productCount: canonicalIds.length
  });

  /* Run validation for each product — fire-and-forget to avoid blocking */
  const validationPromises = canonicalIds.map((cid) =>
    validateProduct(cid).catch((error) => {
      logger.error({
        message: 'Data quality validation failed for product',
        service: 'scheduler',
        canonicalProductId: cid,
        error: error?.message || String(error)
      });
    })
  );

  const results = await Promise.allSettled(validationPromises);
  const succeeded = results.filter((r) => r.status === 'fulfilled').length;

  logger.info({
    message: 'Data quality validation completed for sync batch',
    service: 'scheduler',
    totalAttempted: canonicalIds.length,
    succeeded
  });
}

function getActiveJobs() {
  const jobs = [];
  for (const [storeId, task] of scheduleMap.entries()) {
    const config = scheduleConfigs.get(storeId);
    jobs.push({
      storeId,
      platform: config?.platform || null,
      cronExpression: config?.cronExpression || null,
      nextRunAt: resolveNextRunAt(config?.cronExpression) || config?.nextRunAt || null,
      running: runningJobs.has(storeId)
    });
  }
  return jobs;
}

module.exports = {
  loadSchedules,
  registerJob,
  addSchedule,
  removeSchedule,
  updateSchedule,
  getActiveJobs,
  triggerSync,
  runPlatformSync
};
