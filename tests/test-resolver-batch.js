// test-resolver-batch.js
const { resolveAllProducts } = require('../services/entity-resolution/resolver.service');
require('dotenv').config();

async function test() {
  // Dry run first — see results without saving anything
  const summary = await resolveAllProducts({
    source: 'scraped',   // only scraped products first
    batchSize: 10,
    dryRun: true
  });

  console.log('Batch resolution summary:');
  console.log(JSON.stringify(summary, null, 2));

  // Target: resolutionRate should be > 0.90
  console.log('\nAccuracy target: 90%+');
  console.log('Actual resolution rate:', summary.resolutionRate);
  process.exit(0);
}

test();