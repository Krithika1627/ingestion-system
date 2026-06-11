const logger = require('./logger.service');
const { connectDB, getStoreById, getCollection } = require('./db.service');

async function getLastSyncedAt(storeId) {
  if (!storeId) {
    logger.warn({
      message: 'Missing storeId for getLastSyncedAt',
      service: 'incremental-sync'
    });
    return null;
  }

  try {
    const store = await getStoreById(storeId);
    if (!store) {
      logger.warn({
        message: 'Store not found for getLastSyncedAt',
        service: 'incremental-sync',
        storeId
      });
      return null;
    }

    return store?.lastSyncedAt || null;
  } catch (error) {
    logger.error({
      message: 'Failed to get lastSyncedAt',
      service: 'incremental-sync',
      storeId,
      error: error?.message || String(error)
    });
    return null;
  }
}

async function updateSyncTimestamp(storeId, status, syncResult) {
  if (!storeId) {
    logger.warn({
      message: 'Missing storeId for updateSyncTimestamp',
      service: 'incremental-sync'
    });
    return false;
  }

  try {
    await connectDB();
    const collection = getCollection('stores');

    const failedCount = syncResult?.productSummary?.failed ?? syncResult?.failed ?? 0;
    const totalCount = syncResult?.productSummary?.total ?? syncResult?.total ?? 0;

    let newStatus;
    let advanceCursor;

    if (status === 'failed') {
      newStatus = 'failed';
      advanceCursor = false;
      logger.warn({
        message: 'Sync failed — cursor NOT advanced, will retry same window',
        service: 'incremental-sync',
        storeId,
        status
      });
    } else if (status === 'success' && failedCount > 0) {
      newStatus = 'partial';
      advanceCursor = false;
      logger.warn({
        message: 'Partial sync failure — cursor NOT advanced, will retry same window',
        service: 'incremental-sync',
        storeId,
        total: totalCount,
        failed: failedCount
      });
    } else {
      newStatus = 'success';
      advanceCursor = true;
      logger.info({
        message: 'Cursor advanced',
        service: 'incremental-sync',
        storeId,
        lastSyncedAt: new Date().toISOString(),
        total: totalCount
      });
    }

    const updateFields = {
      $set: { lastSyncStatus: newStatus }
    };

    if (advanceCursor) {
      updateFields.$set.lastSyncedAt = new Date();
    }

    const result = await collection.updateOne(
      { id: storeId },
      updateFields
    );

    if (result.matchedCount === 0) {
      logger.warn({
        message: 'Store not found for sync timestamp update',
        service: 'incremental-sync',
        storeId
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.error({
      message: 'Failed to update sync timestamp',
      service: 'incremental-sync',
      storeId,
      status,
      syncResult: syncResult ? { total: syncResult.total, failed: syncResult.failed } : null,
      error: error?.message || String(error)
    });
    return false;
  }
}

async function getSyncStatus(storeId) {
  if (!storeId) {
    logger.warn({
      message: 'Missing storeId for getSyncStatus',
      service: 'incremental-sync'
    });
    return { lastSyncedAt: null, lastSyncStatus: null };
  }

  try {
    const store = await getStoreById(storeId);
    if (!store) {
      logger.warn({
        message: 'Store not found for getSyncStatus',
        service: 'incremental-sync',
        storeId
      });
      return { lastSyncedAt: null, lastSyncStatus: null };
    }

    return {
      lastSyncedAt: store?.lastSyncedAt || null,
      lastSyncStatus: store?.lastSyncStatus || null
    };
  } catch (error) {
    logger.error({
      message: 'Failed to get sync status',
      service: 'incremental-sync',
      storeId,
      error: error?.message || String(error)
    });
    return { lastSyncedAt: null, lastSyncStatus: null };
  }
}

async function getSyncWindow(storeId) {
  const lastSyncedAt = await getLastSyncedAt(storeId);
  const isFullSync = !lastSyncedAt;

  const window = {
    since: isFullSync ? null : lastSyncedAt,
    isFullSync
  };

  logger.info({
    message: 'Sync window resolved',
    service: 'incremental-sync',
    storeId,
    since: window.since ? window.since.toISOString() : null,
    isFullSync: window.isFullSync
  });

  return window;
}

module.exports = {
  getLastSyncedAt,
  updateSyncTimestamp,
  getSyncWindow,
  getSyncStatus
};
