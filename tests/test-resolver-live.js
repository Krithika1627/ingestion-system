// test-resolver-live.js
const { resolveProduct } = require('../services/entity-resolution/resolver.service');
const mongoose = require('mongoose');
require('dotenv').config();
const { connectDB } = require('../services/db.service');

async function test() {
  await connectDB();
  
  // Fetch one real product from your DB
  const product = await mongoose.connection
    .collection('products')
    .findOne({ source: 'scraped', normalizedBrand: 'mamaearth' });

  console.log('Resolving:', product?.sourceId);
  
  const result = await resolveProduct(product);
  console.log(JSON.stringify(result, null, 2));

  // Expected on first run: resolved: false (it IS the canonical)
  // Expected on second run with same data: resolved: true

  await mongoose.disconnect();
}

test();