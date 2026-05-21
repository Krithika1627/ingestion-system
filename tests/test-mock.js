// test-mock.js
const mock = require('../mock-data/magento-mock.json');
console.log('Products count:', mock.products?.items?.length);
console.log('Categories level:', mock.categories?.level);
console.log('Children_data count:', mock.categories?.children_data?.length);
console.log('First child:', JSON.stringify(mock.categories?.children_data?.[0], null, 2));