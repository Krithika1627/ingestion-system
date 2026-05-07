// Week 2 deliverable
// Responsibilities: auth, fetch products, fetch categories, paginate, handle rate limits
// API: REST API v1 — GET /rest/V1/products, GET /rest/V1/categories
// Auth: Authorization: Bearer {accessToken} header
// Rate limit: No built-in hard limit. Use store.syncConfig.rateLimitDelay (default 1000ms)

const logger = require('../services/logger.service');

async function fetchProducts(store, page = 1) {
  // TODO Week 2: implement GET /rest/V1/products
  // Pagination: searchCriteria[currentPage]=page&searchCriteria[pageSize]=store.syncConfig.batchSize
  // Note: Magento uses page numbers, not cursors
}

async function fetchCategories(store) {
  // TODO Week 2: implement GET /rest/V1/categories
  // Note: By default, Magento returns the entire category tree in one request.
  // We need to parse the recursive 'children_data' array.
}

module.exports = { fetchProducts, fetchCategories };