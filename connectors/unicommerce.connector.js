// Week 2 deliverable
// Responsibilities: auth, fetch item types, fetch inventory snapshots, paginate
// API: REST API — POST /catalog/itemType/get, POST /inventorySnapshot/get
// Auth: Authorization: Bearer {authToken} header + Facility: {facilityCode} header
// Rate limit: No public limit. Use ~1000ms delay. Exponential backoff on 429.

const logger = require('../services/logger.service');

async function fetchItemTypes(store, pageNo = 1) {
  // TODO Week 2: implement POST /catalog/itemType/get
  // Pagination: Pass { facilityCode: "...", pageNo: pageNo, pageSize: store.syncConfig.batchSize } in JSON body
  // Note: This is NOT a full product API. It's used to get SKUs, base prices, and MSP.
}

async function fetchInventorySnapshots(store, pageNo = 1) {
  // TODO Week 2: implement POST /inventorySnapshot/get
  // Pagination: Pass { facilityCode: "...", pageNo: pageNo, pageSize: store.syncConfig.batchSize } in JSON body
  // Note: Returns 'inventory' and 'blockedInventory'. Must be joined with fetchItemTypes via skuCode.
}

// Unicommerce does NOT have a category API. Explicitly not implemented.
const fetchCategories = async () => {
  logger.warn({ message: 'Unicommerce does not support category fetching.' });
  return null; 
};

module.exports = { fetchItemTypes, fetchInventorySnapshots, fetchCategories };