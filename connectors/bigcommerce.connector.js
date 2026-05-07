// Week 2 deliverable
// Responsibilities: auth, fetch products, fetch categories, fetch brands, paginate, handle rate limits
// API: REST API v2/v3 — GET /v2/catalog/products, GET /v2/catalog/trees/{id}/categories, GET /v2/brands
// Auth: X-Auth-Token header
// Rate limit: 60,000/hour. MUST read X-Rate-Limit-Requests-Left header. Pause if < 500.

const logger = require('../services/logger.service');

async function fetchProducts(store, page = 1) {
  // TODO Week 2: implement GET /v2/catalog/products?include=variants,images
  // Pagination: limit=store.syncConfig.batchSize (max 250)&page=page
  // Headers: Read X-Rate-Limit-Requests-Left to prevent 429s
}

async function fetchCategories(store, treeId = 1, page = 1) {
  // TODO Week 2: implement GET /v2/catalog/trees/{treeId}/categories
  // Note: BigCommerce supports multiple category trees. store.credentials.storeHash is needed for base URL.
  // parent_id: 0 means top-level.
}

async function fetchBrands(store, page = 1) {
  // TODO Week 2: implement GET /v2/brands
  // Note: CRITICAL. Products only return 'brand_id'. You MUST fetch brands separately 
  // to map ID -> brand name string for the transformer.
}

module.exports = { fetchProducts, fetchCategories, fetchBrands };