const express = require('express');
const logger = require('../services/logger.service');
const {
  addSchedule,
  removeSchedule,
  updateSchedule,
  getActiveJobs
} = require('../services/scheduler.service');

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

module.exports = router;
