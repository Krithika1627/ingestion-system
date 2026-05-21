// test-cache.js
const { connectDB } = require('../services/db.service');
const mongoose = require('mongoose');
require('dotenv').config();

async function test() {
  await connectDB();
  const cache = mongoose.connection.collection('selector_cache');
  const result = await cache.findOne({ domain: 'www.bewakoof.com' });
  console.log('Cache entry:', JSON.stringify(result, null, 2));
  await mongoose.disconnect();
}

test();