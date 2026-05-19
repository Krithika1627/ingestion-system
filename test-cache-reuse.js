// test-cache-reuse.js
const { fetchRenderedHTML } = require('./services/scraper/playwright.service');
const { extractProductData } = require('./services/scraper/extractor.service');

async function test() {
  const url = 'https://www.bewakoof.com/p/womens-orange-fresh-as-a-daisy-graphic-printed-boyfriend-t-shirt';
  const html = await fetchRenderedHTML(url);
  const result = await extractProductData(html, url);  // returns { product, needsAiSelectors }
  
  const product = result.product;  // unwrap it
  
  console.log('Source:', product?.source);
  console.log('Title:', product?.title);
  console.log('Price:', product?.variants?.[0]?.price);
  console.log('Full product:', JSON.stringify(product, null, 2));
  process.exit(0);
}

test();