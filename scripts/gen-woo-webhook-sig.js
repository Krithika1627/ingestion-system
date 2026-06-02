// scripts/gen-woo-webhook-sig.js
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET || 'test-woo-secret';
const body = JSON.stringify({
  id: 99,
  name: "Test Woo Product",
  sku: "WOO-SKU-001",
  price: "25.00",
  regular_price: "30.00",
  sale_price: "25.00",
  on_sale: true,
  status: "publish", 
  stock_status: "instock",
  stock_quantity: 15,
  description: "A test WooCommerce product",
  categories: [],
  images: []
});
const hmac = crypto.createHmac('sha256', secret).update(body).digest('base64');
fs.writeFileSync('test-woo-body.json', body);
console.log('Body:', body);
console.log('Signature:', hmac);