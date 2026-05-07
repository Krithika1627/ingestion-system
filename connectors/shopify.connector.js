// Week 2 deliverable
// Responsibilities: auth, fetch products, fetch collections, paginate, handle rate limits
// API: GraphQL Admin API — POST /admin/api/2024-01/graphql.json
// Auth: X-Shopify-Access-Token header
// Rate limit: 1000 point bucket, restores 50 points/sec (standard plan)

const logger = require('../services/logger.service');

async function fetchProducts(store, cursor = null) {
  // TODO Week 2: implement GraphQL products query with pagination
}

async function fetchCollections(store, cursor = null) {
  // TODO Week 2: implement GraphQL collections query
}

module.exports = { fetchProducts, fetchCollections };