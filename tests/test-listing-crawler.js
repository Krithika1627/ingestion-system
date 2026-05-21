require('dotenv').config();

const logger = require('../services/logger.service');
const { crawlListingPages } = require('../services/scraper/listing.crawler');
const { fetchRenderedHTML } = require('../services/scraper/playwright.service');
const { extractProductData } = require('../services/scraper/extractor.service');

const TEST_URLS = [
  'https://www.bewakoof.com/men-t-shirts',
  'https://www.fabindia.com/clothing',
  'https://www.ajio.com/men-shirts/c/830216013'
];

async function logListingResult(startUrl) {
  const result = await crawlListingPages(startUrl, { maxPages: 10, maxProducts: 200, delayMs: 1500 });
  const urls = Array.isArray(result) ? result : [];
  const pagesVisited = result?.pagesVisited || 0;
  const usedDynamicPagination = Boolean(result?.usedDynamicPagination);

  logger.info({
    startUrl,
    pagesVisited,
    totalProductUrls: urls.length,
    sampleUrls: urls.slice(0, 5),
    usedDynamicPagination
  });

  return urls;
}

async function runEndToEnd(startUrl) {
  const urls = await crawlListingPages(startUrl, { maxPages: 5, maxProducts: 50, delayMs: 1500 });
  const productUrls = Array.isArray(urls) ? urls.slice(0, 3) : [];

  for (const productUrl of productUrls) {
    try {
      const html = await fetchRenderedHTML(productUrl);
      const { product } = await extractProductData(html, productUrl);
      logger.info({
        message: 'Extracted product sample',
        url: productUrl,
        title: product?.title || null,
        price: product?.variants?.[0]?.price ?? null,
        currency: product?.variants?.[0]?.currency || null
      });
    } catch (error) {
      logger.warn({
        message: 'Sample product extraction failed',
        url: productUrl,
        error: error?.message || String(error)
      });
    }
  }
}

async function run() {
  for (const url of TEST_URLS) {
    await logListingResult(url);
  }

  await runEndToEnd('https://www.bewakoof.com/men-t-shirts');
  process.exit(0);
}

run();
