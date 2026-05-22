// test-ingestion-mode.js
const { scrapeStore } = require('../services/scraper/scraper.orchestrator');

const TEST_STORES = [
  // Known platform stores — should be SKIPPED
  'https://mystore.myshopify.com',          // Shopify domain pattern
  'https://demo.woothemes.com/storefront',  // WooCommerce HTML signal
  'https://mystore.mybigcommerce.com',      // BigCommerce domain pattern

  // Generic stores — should SCRAPE normally
  'https://www.mamaearth.in',              // already tested, known working
  'https://www.bewakoof.com/men-t-shirts'  // already tested, known working
];

async function test() {
  for (const storeUrl of TEST_STORES) {
    console.log('\n' + '='.repeat(60));
    console.log('Testing:', storeUrl);
    console.log('='.repeat(60));

    const result = await scrapeStore(storeUrl, null, { maxProducts: 3 });

    if (result?.skipped) {
      console.log('✅ SKIPPED CORRECTLY');
      console.log('   Reason:', result.reason);
      console.log('   Platform:', result.platform);
      console.log('   Message:', result.message);
    } else {
      console.log('✅ SCRAPED');
      console.log('   Products found:', result?.length || 0);
    }
  }

  process.exit(0);
}

test();