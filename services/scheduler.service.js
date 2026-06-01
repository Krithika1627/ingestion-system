const cron = require('node-cron');
const { CronExpressionParser } = require('cron-parser');
const logger = require('./logger.service');
const { SyncConfig, DEFAULT_CRON_BY_PLATFORM } = require('../models/sync_config.model');
const { connectDB, getStoreById } = require('./db.service');
const { runShopifyFullSync } = require('../pipelines/shopify.pipeline');
const { runMagentoFullSync } = require('../pipelines/magento.pipeline');
const { runWooFullSync } = require('../pipelines/woocommerce.pipeline');
const { runBigCommerceFullSync } = require('../pipelines/bigcommerce.pipeline');
const { runUnicommerceInventorySync } = require('../pipelines/unicommerce.pipeline');
const { scrapeStore } = require('./scraper/scraper.orchestrator');

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

async function runPlatformSync(platform, storeId) {
  switch (platform) {
    case 'shopify':
      return runShopifyFullSync(storeId);
    case 'magento':
      return runMagentoFullSync(storeId || 'store_magento_001');
    case 'woocommerce':
      return runWooFullSync(storeId || 'store_woo_001');
    case 'bigcommerce':
      return runBigCommerceFullSync(storeId || 'store_bigcommerce_001');
    case 'unicommerce':
      return runUnicommerceInventorySync(storeId || 'store_unicommerce_001');
    case 'scraped': {
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
    runningJobs.add(config.storeId);
    logger.info({
      message: 'Scheduler job started',
      service: 'scheduler',
      storeId: config.storeId,
      platform: config.platform
    });

    let outcome = 'success';
    try {
      await runPlatformSync(config.platform, config.storeId);
    } catch (error) {
      outcome = 'failed';
      logger.warn({
        message: 'Scheduler job failed',
        service: 'scheduler',
        storeId: config.storeId,
        platform: config.platform,
        error: error?.message || String(error)
      });
    } finally {
      runningJobs.delete(config.storeId);
      const durationMs = Date.now() - startedAt.getTime();
      const nextRunAt = resolveNextRunAt(config.cronExpression);
      await updateRunTimestamps(config, nextRunAt, startedAt);
      logger.info({
        message: 'Scheduler job finished',
        service: 'scheduler',
        storeId: config.storeId,
        platform: config.platform,
        outcome,
        durationMs
      });
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
  getActiveJobs
};
