// test-resolver-score.js
const { scoreEntitySimilarity } = require('../services/entity-resolution/resolver.service');

async function test() {

  // Should match — same product different sources
  const productA = {
    title: "Mamaearth Onion Hair Oil 250ml",
    cleanedTitle: "Mamaearth Onion Hair Oil 250ml",
    brand: "Mamaearth",
    normalizedBrand: "mamaearth",
    category: "Hair Care",
    sku: "ME-OHO-250",
    attributes: { size: "250ml", type: "hair oil" },
    variants: [{ price: 349, currency: "INR" }]
  };

  const productB = {
    title: "Onion Hair Oil 250 ml - Mamaearth",
    cleanedTitle: "Onion Hair Oil 250 ml Mamaearth",
    brand: "Mamaearth",
    normalizedBrand: "mamaearth",
    category: "Hair Care",
    sku: null,
    attributes: { size: "250 ml" },
    variants: [{ price: 359, currency: "INR" }]
  };

  const result = scoreEntitySimilarity(productA, productB);
  console.log('Should match (expect score >= 0.85):');
  console.log(JSON.stringify(result, null, 2));

  // Should NOT match — different products
  const productC = {
    title: "Mamaearth Vitamin C Face Wash 100ml",
    cleanedTitle: "Mamaearth Vitamin C Face Wash 100ml",
    brand: "Mamaearth",
    normalizedBrand: "mamaearth",
    category: "Skin Care",
    sku: "ME-VCF-100",
    attributes: { size: "100ml" },
    variants: [{ price: 299, currency: "INR" }]
  };

  const result2 = scoreEntitySimilarity(productA, productC);
  console.log('\nShould NOT match (expect score < 0.85):');
  console.log(JSON.stringify(result2, null, 2));

  // SKU hard match
  const productD = { ...productC, sku: "ME-OHO-250" };
  const result3 = scoreEntitySimilarity(productA, productD);
  console.log('\nSKU hard match (expect score 1.0, hardMatch: "sku"):');
  console.log(JSON.stringify(result3, null, 2));
}

test();