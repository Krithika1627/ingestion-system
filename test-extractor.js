const { fetchRenderedHTML } = require('./services/scraper/playwright.service');
const { extractProductData } = require('./services/scraper/extractor.service');

async function test() {
  const url = 'https://mamaearth.in/product/onion-hair-oil';
  const html = await fetchRenderedHTML(url);
  const product = await extractProductData(html, url);
  console.log(JSON.stringify(product, null, 2));
}

test();