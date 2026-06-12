const SchedulerLock = require('../models/scheduler_lock.model');

async function acquireLock(storeId) {
  try {
    console.log("Attempting lock for", storeId);
    await SchedulerLock.create({
      storeId,
      expiresAt: new Date(
        Date.now() + 15 * 60 * 1000
      )
    });

    return true;
  } catch {
    return false;
  }
}

async function releaseLock(storeId) {
  console.log("Releasing lock for", storeId);
  await SchedulerLock.deleteOne({ storeId });
}

module.exports = {
  acquireLock,
  releaseLock
};