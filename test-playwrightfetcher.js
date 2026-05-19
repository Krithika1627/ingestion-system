const { fetchRenderedHTML } = require('./services/scraper/playwright.service');

async function debug() {
  const html = await fetchRenderedHTML('https://mamaearth.in/product/mineral-based-sunscreen-india');
  console.log('HTML length:', html.length);
  console.log('Has JSON-LD:', html.includes('application/ld+json'));
  console.log('Has og:title:', html.includes('og:title'));
  console.log('Has og:price:', html.includes('og:price'));
  
  // Print the first og: tag found
  const match = html.match(/<meta[^>]+og:[^>]+>/g);
  console.log('OG tags found:', match?.slice(0, 5));
}

debug();