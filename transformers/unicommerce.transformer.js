/**
 * Transforms Unicommerce inventory snapshots into offer inventory patches.
 */

/**
 * Derive availability from inventory quantity and threshold.
 * @param {number} qty
 * @param {number} threshold
 * @returns {string}
 */
function deriveAvailability(qty, threshold = 10) {
  if (qty <= 0) {
    return 'out_of_stock';
  }
  if (qty <= threshold) {
    return 'limited';
  }
  return 'in_stock';
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Transform an inventory snapshot into an offer inventory patch.
 * @param {object} snapshot
 * @param {string} storeId
 * @param {number} availabilityThreshold
 * @returns {object}
 */
function transformInventorySnapshot(snapshot, storeId, availabilityThreshold) {
  const sourceSnapshot = snapshot || {};
  const inventory = toNumber(sourceSnapshot?.inventory);
  const blocked = toNumber(sourceSnapshot?.blockedInventory) ?? 0;
  const totalInventory = inventory ?? 0;
  const available = Math.max(0, totalInventory - (blocked || 0));
  const threshold = typeof availabilityThreshold === 'number' ? availabilityThreshold : 10;

  return {
    sku: sourceSnapshot?.itemTypeSKU || null,
    availableInventory: available,
    totalInventory,
    blockedInventory: blocked || 0,
    facilityCode: sourceSnapshot?.facilityCode || null,
    availability: deriveAvailability(available, threshold),
    stockQty: available,
    isInStock: available > 0,
    lastSyncedAt: new Date().toISOString(),
    inventorySource: 'unicommerce',
    storeId
  };
}

module.exports = { transformInventorySnapshot };
