const logger = require('./logger.service');
const { connectDB } = require('./db.service');
const { FailedJob } = require('../models/failed_job.model');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeToDeadLetterQueue(config, error, attemptNumber, syncWindow) {
  await connectDB();

  const failedJob = new FailedJob({
    storeId: config.storeId,
    platform: config.platform,
    cronExpression: config.cronExpression || null,
    attemptNumber,
    totalAttempts: 3,
    error: error?.message || String(error),
    errorStack: error?.stack || null,
    syncWindow: {
      isFullSync: syncWindow?.isFullSync || false,
      since: syncWindow?.since || null
    },
    failedAt: new Date(),
    status: 'pending_review',
    resolvedAt: null
  });

  const saved = await failedJob.save();

  logger.warn({
    message: 'DEAD LETTER: Sync job failed after 3 attempts',
    service: 'retry',
    storeId: config.storeId,
    platform: config.platform,
    error: error?.message || String(error),
    failedAt: saved.failedAt.toISOString(),
    failedJobId: String(saved._id)
  });

  return saved;
}

async function executeWithRetry(config, syncFn, syncWindow) {
  const MAX_ATTEMPTS = 3;
  const DELAYS = [0, 60000, 300000]; // attempt 1: no wait, attempt 2: 1min, attempt 3: 5min

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Wait before this attempt (attempt 1 has no delay)
    if (DELAYS[attempt - 1] > 0) {
      logger.info({
        message: `Retry delay: waiting ${DELAYS[attempt - 1] / 1000} minutes before attempt ${attempt}`,
        service: 'retry',
        storeId: config.storeId,
        platform: config.platform,
        attempt
      });
      await sleep(DELAYS[attempt - 1]);
    }

    try {
      logger.info({
        message: `Sync attempt ${attempt}/${MAX_ATTEMPTS} starting`,
        service: 'retry',
        storeId: config.storeId,
        platform: config.platform,
        attempt
      });

      const syncResult = await syncFn(config.storeId, syncWindow);

      logger.info({
        message: `Sync attempt ${attempt}/${MAX_ATTEMPTS} succeeded`,
        service: 'retry',
        storeId: config.storeId,
        platform: config.platform,
        attempt
      });

      return { success: true, attempts: attempt, result: syncResult };
    } catch (error) {
      logger.warn({
        message: `Sync attempt ${attempt}/${MAX_ATTEMPTS} failed`,
        service: 'retry',
        storeId: config.storeId,
        platform: config.platform,
        attempt,
        error: error?.message || String(error)
      });

      // If this was the last attempt, write to dead-letter queue
      // (writeToDeadLetterQueue already emits the DEAD LETTER warn log)
      if (attempt === MAX_ATTEMPTS) {
        await writeToDeadLetterQueue(config, error, attempt, syncWindow);
        return { success: false, attempts: attempt, result: null };
      }
    }
  }

  // Should not reach here, but safety net
  return { success: false, attempts: MAX_ATTEMPTS, result: null };
}

module.exports = {
  sleep,
  executeWithRetry,
  writeToDeadLetterQueue
};
