const { fetchRenderedHTML } = require('./services/scraper/playwright.service');
const { extractProductData } = require('./services/scraper/extractor.service');

async function test() {
  const url = 'https://mamaearth.in/product/mineral-based-sunscreen-india';
  const html = await fetchRenderedHTML(url);
  const product = await extractProductData(html, url);
  console.log(JSON.stringify(product, null, 2));
  process.exit(0);
}

test();