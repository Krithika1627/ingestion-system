const { scrapeStore } = require('../services/scraper/scraper.orchestrator');

async function test() {
  const products = await scrapeStore('https://mamaearth.in', 'store_scraper_001', {
    maxProducts: 10  // add this limit
  });
  
  console.log(`Scraped ${products.length} products`);
  console.log('Sample product:', JSON.stringify(products[0], null, 2));
  
  const complete = products.filter(
    p =>
      p.title &&
      p.variants?.length > 0 &&
      p.images?.length > 0
  );
  console.log(`Complete records: ${complete.length}/${products.length}`);
  process.exit(0);
}

test();