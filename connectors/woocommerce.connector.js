// Week 2 deliverable
// Responsibilities: auth, fetch products, fetch categories, paginate, handle rate limits
// API: REST API v3 — GET /wp-json/wc/v3/products, GET /wp-json/wc/v3/products/categories
// Auth: Basic Auth via query params (?consumer_key=...&consumer_secret=...)
// Rate limit: No built-in limit. Use store.syncConfig.rateLimitDelay (default 500ms)

const logger = require('../services/logger.service');

async function fetchProducts(store, page = 1) {
  // TODO Week 2: implement GET /wp-json/wc/v3/products
  // Pagination: per_page=store.syncConfig.batchSize (max 100)&page=page
  // Auth: Append store.credentials.consumerKey & consumerSecret to URL
}

async function fetchCategories(store, page = 1) {
  // TODO Week 2: implement GET /wp-json/wc/v3/products/categories
  // Pagination: per_page=100&page=page
  // Note: Categories are flat. Parent/child relationship is determined by the 'parent' integer field.
}

module.exports = { fetchProducts, fetchCategories };