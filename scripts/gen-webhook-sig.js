// require('dotenv').config();
// const crypto = require('crypto');
// const fs = require('fs');
// const secret = process.env.SHOPIFY_WEBHOOK_SECRET || 'test-secret';
// const body = JSON.stringify({
//   id: 123,
//   title: "Test Product",
//   body_html: "Test description",
//   vendor: "Test Vendor",
//   product_type: "Shoes",
//   status: "active",
//   tags: "test",
//   created_at: new Date().toISOString(),
//   updated_at: new Date().toISOString(),
//   variants: [
//     {
//       id: 456,
//       sku: "TEST-SKU-001",
//       price: "29.99",
//       compare_at_price: "39.99",
//       inventory_quantity: 10,
//       inventory_item_id: 789
//     }
//   ],
//   images: []
// });
// const hmac = crypto.createHmac('sha256', secret).update(body).digest('base64');
// fs.writeFileSync('test-body.json', body);
// console.log('Body:', body);
// console.log('HMAC:', hmac);

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const secret = process.env.SHOPIFY_WEBHOOK_SECRET || 'test-secret';
const body = JSON.stringify({
  id: 15542604824945,
  title: "Webhook Test Title",
  variants: []
});
const hmac = crypto.createHmac('sha256', secret).update(body).digest('base64');
fs.writeFileSync('test-delete-body.json', body);
console.log('Body:', body);
console.log('HMAC:', hmac);