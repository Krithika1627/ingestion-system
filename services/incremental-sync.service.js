/**
 * Incremental sync service — tracks last sync timestamps per store
 * and provides sync windows so connectors can fetch only changed data.
 */
const logger = require('./logger.service');
const { connectDB, getStoreById, getCollection } = require('./db.service');

/**
 * Get the last successful sync timestamp for a store.
 * @param {string} storeId
 * @returns {Promise<Date|null>}
 */
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

/**
 * Update lastSyncedAt and lastSyncStatus for a store.
 * @param {string} storeId
 * @param {'success'|'failed'} status
 * @returns {Promise<boolean>}
 */
async function updateSyncTimestamp(storeId, status) {
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
    const result = await collection.updateOne(
      { id: storeId },
      {
        $set: {
          lastSyncedAt: new Date(),
          lastSyncStatus: status
        }
      }
    );

    if (result.matchedCount === 0) {
      logger.warn({
        message: 'Store not found for sync timestamp update',
        service: 'incremental-sync',
        storeId
      });
      return false;
    }

    logger.info({
      message: 'Store sync timestamp updated',
      service: 'incremental-sync',
      storeId,
      status
    });

    return true;
  } catch (error) {
    logger.error({
      message: 'Failed to update sync timestamp',
      service: 'incremental-sync',
      storeId,
      status,
      error: error?.message || String(error)
    });
    return false;
  }
}

/**
 * Get the sync window for a store — determines whether to run a full
 * sync or an incremental sync based on lastSyncedAt.
 * @param {string} storeId
 * @returns {Promise<{ since: Date|null, isFullSync: boolean }>}
 */
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
  getSyncWindow
};
