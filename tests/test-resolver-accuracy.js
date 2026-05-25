// test-resolver-accuracy.js
const { measureAccuracy } = require('../services/entity-resolution/resolver.service');
require('dotenv').config();

// Build ground truth from your real MongoDB sourceIds
// Check your DB for actual sourceIds to use here
const groundTruth = [
  {
    label: "Same mamaearth product ingested twice",
    sourceIdA: "https://mamaearth.in/product/organic-baby-shampoo-online",
    sourceIdB: "https://mamaearth.in/product/organic-baby-shampoo-online",
    shouldMatch: true
  },
  {
    label: "Different mamaearth products",
    sourceIdA: "https://mamaearth.in/product/organic-baby-shampoo-online",
    sourceIdB: "https://mamaearth.in/product/mineral-based-sunscreen-india",
    shouldMatch: false
  },
  {
    label: "Different mamaearth products same brand",
    sourceIdA: "https://mamaearth.in/product/argan-hair-mask",
    sourceIdB: "https://mamaearth.in/product/buy-hair-conditioner-online",
    shouldMatch: false
  },
  {
    label: "Same bewakoof product ingested twice",
    sourceIdA: "https://www.bewakoof.com/p/mens-black-misfit-typography-sweatshirt",
    sourceIdB: "https://www.bewakoof.com/p/mens-black-misfit-typography-sweatshirt",
    shouldMatch: true
  },
  {
    label: "Different bewakoof products",
    sourceIdA: "https://www.bewakoof.com/p/mens-black-misfit-typography-sweatshirt",
    sourceIdB: "https://www.bewakoof.com/p/mens-gardenia-stamp-graphic-printed-oversized-hoodies",
    shouldMatch: false
  }
];

async function test() {
  const result = await measureAccuracy(groundTruth);
  console.log('Accuracy results:');
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nAccuracy: ${(result.accuracy * 100).toFixed(1)}%`);
  console.log('Target: 90%+');
  process.exit(0);
}

test();