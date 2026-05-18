const { fetchRenderedHTML } = require('./services/scraper/playwright.service');

async function test() {
  const html = await fetchRenderedHTML('https://mamaearth.in/product/onion-hair-oil');
  console.log('HTML length:', html.length);
  console.log('Has JSON-LD:', html.includes('application/ld+json'));
  console.log('Has og:title:', html.includes('og:title'));
}

test();