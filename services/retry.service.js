/**
 * Retry service — provides exponential backoff retry logic for scheduler sync jobs
 * and a dead-letter queue that persists permanently-failed jobs to MongoDB.
 */
const logger = require('./logger.service');
const { connectDB } = require('./db.service');
const { FailedJob } = require('../models/failed_job.model');

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Write a permanently-failed job to the dead-letter queue (failed_jobs collection).
 * Logs a WARN-level alert that in production would trigger PagerDuty/Slack.
 *
 * @param {object} config - Sync config { storeId, platform, cronExpression }
 * @param {Error} error - The final error from attempt 3
 * @param {number} attemptNumber - Which attempt failed (3)
 * @param {object} syncWindow - { isFullSync, since }
 * @returns {Promise<object>} The saved FailedJob document
 */
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

/**
 * Execute a sync function with retry logic and exponential backoff.
 *
 * Retry schedule:
 *   Attempt 1 → fail → wait 1 minute → Attempt 2
 *   Attempt 2 → fail → wait 5 minutes → Attempt 3
 *   Attempt 3 → fail → write to dead-letter queue
 *
 * @param {object} config - Sync config { storeId, platform, cronExpression }
 * @param {function} syncFn - Async function (storeId, syncWindow) => Promise<any>
 * @param {object} syncWindow - { isFullSync: boolean, since: Date|null }
 * @returns {Promise<{ success: boolean, attempts: number }>}
 */
async function executeWithRetry(config, syncFn, syncWindow) {
  const MAX_ATTEMPTS = 3;
  const DELAYS = [0, 3000, 6000]; // attempt 1: no wait, attempt 2: 1min, attempt 3: 5min

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

      await syncFn(config.storeId, syncWindow);

      logger.info({
        message: `Sync attempt ${attempt}/${MAX_ATTEMPTS} succeeded`,
        service: 'retry',
        storeId: config.storeId,
        platform: config.platform,
        attempt
      });

      return { success: true, attempts: attempt };
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
        return { success: false, attempts: attempt };
      }
    }
  }

  // Should not reach here, but safety net
  return { success: false, attempts: MAX_ATTEMPTS };
}

module.exports = {
  sleep,
  executeWithRetry,
  writeToDeadLetterQueue
};
