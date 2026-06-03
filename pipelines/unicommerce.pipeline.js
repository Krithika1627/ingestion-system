/**
 * Unicommerce inventory sync pipeline.
 */
const logger = require('../services/logger.service');
const { fetchInventorySnapshots } = require('../connectors/unicommerce.connector');
const { transformInventorySnapshot } = require('../transformers/unicommerce.transformer');
const {
  updateOfferInventory,
  updateStoreLastSynced,
  getStoreById
} = require('../services/db.service');

/**
 * Run Unicommerce inventory sync.
 * @param {string} storeId
 * @param {string} facilityCode
 * @param {Date|null} [since] - Optional: only fetch items updated after this date (in-memory filter)
 * @returns {Promise<{total:number, updated:number, skipped:number, failed:number, duration:number}>}
 */
async function runUnicommerceInventorySync(storeId = 'store_unicommerce_001', facilityCode, since) {
  const pipelineStoreId = storeId || 'store_unicommerce_001';
  const startTime = Date.now();

  const storeRecord = await getStoreById(pipelineStoreId);
  const resolvedFacility =
    facilityCode ||
    storeRecord?.metaData?.facilityCode ||
    process.env.UNICOMMERCE_FACILITY_CODE ||
    null;
  const availabilityThreshold = storeRecord?.syncConfig?.availabilityThreshold ?? 10;

  logger.info({
    message: 'Unicommerce inventory pipeline started',
    platform: 'unicommerce',
    storeId: pipelineStoreId,
    facilityCode: resolvedFacility
  });

  const snapshots = await fetchInventorySnapshots(
    {
      id: pipelineStoreId,
      metaData: storeRecord?.metaData || {},
      syncConfig: storeRecord?.syncConfig || {}
    },
    resolvedFacility,
    since
  );

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const snapshot of snapshots) {
    try {
      const patch = transformInventorySnapshot(snapshot, pipelineStoreId, availabilityThreshold);
      if (!patch?.sku) {
        skipped += 1;
        logger.warn({
          message: 'Skipping inventory update due to missing SKU',
          platform: 'unicommerce',
          storeId: pipelineStoreId
        });
        continue;
      }

      const result = await updateOfferInventory(patch.sku, patch, pipelineStoreId);
      if (result?.offersMatched > 0) {
        updated += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      logger.error({
        message: 'Unicommerce inventory update failed',
        platform: 'unicommerce',
        storeId: pipelineStoreId,
        sku: snapshot?.itemTypeSKU || null,
        error: error?.message || String(error)
      });
    }
  }

  const duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
  const summary = {
    total: snapshots.length,
    updated,
    skipped,
    failed,
    duration
  };

  logger.info({
    message: 'Unicommerce inventory pipeline complete',
    platform: 'unicommerce',
    storeId: pipelineStoreId,
    ...summary
  });

  await updateStoreLastSynced(pipelineStoreId);

  return summary;
}

module.exports = { runUnicommerceInventorySync };
