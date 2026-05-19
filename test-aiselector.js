const { generateSelectors } = require('./services/scraper/ai.selector');

async function test() {
  const { fetchRenderedHTML } = require('./services/scraper/playwright.service');
  
  // Use a URL that failed JSON-LD earlier
  const url = 'https://mamaearth.in/product/onion-hair-oil';
  const html = await fetchRenderedHTML(url);
  
  const selectors = await generateSelectors(html, url);
  console.log('Generated selectors:', JSON.stringify(selectors, null, 2));
}

test();