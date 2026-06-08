const express = require('express');
const logger = require('../services/logger.service');
const { connectDB } = require('../services/db.service');
const { executeWithRetry } = require('../services/retry.service');
const { FailedJob } = require('../models/failed_job.model');
const {
  addSchedule,
  removeSchedule,
  updateSchedule,
  getActiveJobs,
  triggerSync
} = require('../services/scheduler.service');
const { runPlatformSync } = require('../services/scheduler.service');

const router = express.Router();

router.post('/add', async (req, res) => {
  try {
    const { storeId, platform, cronExpression } = req.body || {};
    if (!storeId || !platform) {
      res.status(400).json({ success: false, error: 'storeId and platform are required' });
      return;
    }

    const config = await addSchedule(storeId, platform, cronExpression);
    res.json({ success: true, schedule: config });
  } catch (error) {
    const status = error?.message?.includes('cron') ? 400 : 500;
    logger.error({
      message: 'Failed to add schedule',
      service: 'scheduler',
      error: error?.message || String(error)
    });
    res.status(status).json({ success: false, error: error?.message || 'Failed to add schedule' });
  }
});

router.delete('/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params || {};
    if (!storeId) {
      res.status(400).json({ success: false, error: 'storeId required' });
      return;
    }

    await removeSchedule(storeId);
    res.json({ success: true });
  } catch (error) {
    logger.error({
      message: 'Failed to remove schedule',
      service: 'scheduler',
      error: error?.message || String(error)
    });
    res.status(500).json({ success: false, error: error?.message || 'Failed to remove schedule' });
  }
});

router.put('/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params || {};
    const { cronExpression } = req.body || {};
    if (!storeId || !cronExpression) {
      res.status(400).json({ success: false, error: 'storeId and cronExpression are required' });
      return;
    }

    const config = await updateSchedule(storeId, cronExpression);
    res.json({ success: true, schedule: config });
  } catch (error) {
    const status = error?.message?.includes('cron') ? 400 : 500;
    logger.error({
      message: 'Failed to update schedule',
      service: 'scheduler',
      error: error?.message || String(error)
    });
    res.status(status).json({ success: false, error: error?.message || 'Failed to update schedule' });
  }
});

router.post('/sync/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params || {};
    const { force } = req.body || {};
    if (!storeId) {
      res.status(400).json({ success: false, error: 'storeId required' });
      return;
    }

    const result = await triggerSync(storeId, { force: force === true });
    res.json({ success: true, message: 'Sync completed', ...result });
  } catch (error) {
    const status = error?.message?.includes('No schedule found') ? 404 : 500;
    logger.error({
      message: 'Manual sync failed',
      service: 'scheduler',
      storeId: req?.params?.storeId || null,
      error: error?.message || String(error)
    });
    res.status(status).json({ success: false, error: error?.message || 'Manual sync failed' });
  }
});

router.get('/jobs', async (req, res) => {
  try {
    const jobs = getActiveJobs();
    res.json({ success: true, jobs });
  } catch (error) {
    logger.error({
      message: 'Failed to fetch scheduler jobs',
      service: 'scheduler',
      error: error?.message || String(error)
    });
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch scheduler jobs' });
  }
});

router.get('/failed-jobs', async (req, res) => {
  try {
    await connectDB();
    const jobs = await FailedJob.find({ status: 'pending_review' })
      .sort({ failedAt: -1 })
      .lean();
    res.json({ success: true, failedJobs: jobs });
  } catch (error) {
    logger.error({
      message: 'Failed to fetch failed jobs',
      service: 'scheduler',
      error: error?.message || String(error)
    });
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch failed jobs' });
  }
});

router.put('/failed-jobs/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ success: false, error: 'Failed job ID required' });
      return;
    }

    await connectDB();
    const job = await FailedJob.findByIdAndUpdate(
      id,
      { $set: { status: 'resolved', resolvedAt: new Date() } },
      { new: true }
    );

    if (!job) {
      res.status(404).json({ success: false, error: 'Failed job not found' });
      return;
    }

    logger.info({
      message: 'Failed job marked as resolved',
      service: 'scheduler',
      failedJobId: id,
      storeId: job.storeId,
      platform: job.platform
    });

    res.json({ success: true, failedJob: job });
  } catch (error) {
    logger.error({
      message: 'Failed to resolve failed job',
      service: 'scheduler',
      error: error?.message || String(error)
    });
    res.status(500).json({ success: false, error: error?.message || 'Failed to resolve failed job' });
  }
});

router.post('/failed-jobs/:id/retry', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ success: false, error: 'Failed job ID required' });
      return;
    }

    await connectDB();
    const failedJob = await FailedJob.findById(id);

    if (!failedJob) {
      res.status(404).json({ success: false, error: 'Failed job not found' });
      return;
    }

    if (failedJob.status === 'resolved') {
      res.status(400).json({ success: false, error: 'Failed job is already resolved' });
      return;
    }

    const config = {
      storeId: failedJob.storeId,
      platform: failedJob.platform,
      cronExpression: failedJob.cronExpression
    };

    const syncWindow = {
      isFullSync: failedJob.syncWindow?.isFullSync ?? true,
      since: failedJob.syncWindow?.since || null
    };

    const syncFn = (storeId, window) =>
      runPlatformSync(config.platform, storeId, window.since);

    const result = await executeWithRetry(config, syncFn, syncWindow);

    if (result.success) {
      failedJob.status = 'resolved';
      failedJob.resolvedAt = new Date();
      await failedJob.save();

      logger.info({
        message: 'Dead-lettered job retry succeeded',
        service: 'scheduler',
        failedJobId: id,
        storeId: failedJob.storeId,
        platform: failedJob.platform,
        attempts: result.attempts
      });

      res.json({ success: true, message: 'Retry succeeded', attempts: result.attempts });
    } else {
      logger.warn({
        message: 'Dead-lettered job retry failed again',
        service: 'scheduler',
        failedJobId: id,
        storeId: failedJob.storeId,
        platform: failedJob.platform,
        attempts: result.attempts
      });

      res.status(500).json({ success: false, message: 'Retry failed after 3 attempts', attempts: result.attempts });
    }
  } catch (error) {
    logger.error({
      message: 'Failed to retry dead-lettered job',
      service: 'scheduler',
      error: error?.message || String(error)
    });
    res.status(500).json({ success: false, error: error?.message || 'Failed to retry dead-lettered job' });
  }
});

module.exports = router;
