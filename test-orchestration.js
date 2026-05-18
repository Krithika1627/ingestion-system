const { scrapeStore } = require('./services/scraper/scraper.orchestrator');

async function test() {
  const products = await scrapeStore('https://mamaearth.in');
  console.log(`Scraped ${products.length} products`);
  console.log('Sample product:', JSON.stringify(products[0], null, 2));
  
  // Check how many had complete data
  const complete = products.filter(p => p.title && p.price && p.images?.length > 0);
  console.log(`Complete records: ${complete.length}/${products.length}`);
}

test();