// Week 2 deliverable
// Orchestrates: connector → transformer → validator → DB upsert
// Order: categories must be ingested before products

const logger = require('../services/logger.service');

async function runProductPipeline(store) {
  // TODO Week 2:
  // 1. Call connector to fetch raw platform data
  // 2. Pass to transformer to get canonical format
  // 3. Validate against product.schema.json using AJV
  // 4. Upsert into MongoDB products collection
}

module.exports = { runProductPipeline };