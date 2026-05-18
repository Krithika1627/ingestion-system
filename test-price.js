const { normalizePrice } = require('./services/scraper/price.normalizer');

console.log(normalizePrice("₹1,299"));           // { amount: 1299, currency: "INR" }
console.log(normalizePrice("$12.99"));           // { amount: 12.99, currency: "USD" }
console.log(normalizePrice("1,299.00 INR"));     // { amount: 1299, currency: "INR" }
console.log(normalizePrice("Rs. 499"));          // { amount: 499, currency: "INR" }
console.log(normalizePrice("USD 12.99"));        // { amount: 12.99, currency: "USD" }