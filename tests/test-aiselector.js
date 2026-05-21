const { generateSelectors } = require('../services/scraper/ai.selector');
const { fetchRenderedHTML } = require('../services/scraper/playwright.service');

async function test() {
  const url = 'https://www.bewakoof.com/p/womens-orange-fresh-as-a-daisy-graphic-printed-boyfriend-t-shirt';  
  const html = await fetchRenderedHTML(url);
  
  console.log('HTML length:', html?.length);
  console.log('Has JSON-LD:', html?.includes('application/ld+json'));
  console.log('Has og:title:', html?.includes('og:title'));
  console.log('Has og:price:', html?.includes('og:price'));

  const selectors = await generateSelectors(html, url);
  console.log('Generated selectors:', JSON.stringify(selectors, null, 2));
  process.exit(0);
}

test();