const logger = require('../logger.service');
const { fetchRenderedHTML } = require('./playwright.service');
const { extractProductData } = require('./extractor.service');
const { getSitemapUrls } = require('./sitemap.crawler');
const { getProductUrlsFromListing } = require('./listing.crawler');
const { runScraperProductPipeline } = require('./scraper.pipeline');

const TEST_SCRAPE_LIMIT = 10;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDelayMs() {
  return 1000 + Math.floor(Math.random() * 1000);
}

async function crawlListingPages(storeUrl, maxPages = 10) {
  const urls = new Set();
  const visited = new Set();
  let nextPage = storeUrl;

  while (nextPage && visited.size < maxPages) {
    if (visited.has(nextPage)) {
      break;
    }
    visited.add(nextPage);

    try {
      const html = await fetchRenderedHTML(nextPage);
      const { productUrls, nextPageUrl } = await getProductUrlsFromListing(html, nextPage);
      productUrls.forEach((url) => urls.add(url));
      nextPage = nextPageUrl;
    } catch (error) {
      logger.warn({
        message: 'Listing page crawl failed',
        service: 'scraper',
        url: nextPage,
        error: error?.message || String(error)
      });
      break;
    }
  }

  return Array.from(urls);
}

async function scrapeStore(storeUrl, storeId) {
  const pipelineStoreId = storeId || process.env.SCRAPER_STORE_ID || null;
  logger.info({
    message: 'Scrape started',
    service: 'scraper',
    url: storeUrl
  });

  let productUrls = [];
  try {
    productUrls = await getSitemapUrls(storeUrl);
  } catch (error) {
    logger.warn({
      message: 'Sitemap lookup failed',
      service: 'scraper',
      url: storeUrl,
      error: error?.message || String(error)
    });
  }

  if (productUrls.length === 0) {
    productUrls = await crawlListingPages(storeUrl, 10);
  }

  const uniqueProductUrls = Array.from(new Set(productUrls));
  const limitedUrls = uniqueProductUrls.slice(0, TEST_SCRAPE_LIMIT);
  logger.info({
    message: 'Scrape batch limited for testing',
    service: 'scraper',
    url: storeUrl,
    originalCount: uniqueProductUrls.length,
    limitedCount: limitedUrls.length
  });
  const results = [];
  const scrapedItems = [];

  for (let index = 0; index < limitedUrls.length; index += 1) {
    const productUrl = limitedUrls[index];
    if (index > 0) {
      await sleep(getDelayMs());
    }

    try {
      const html = await fetchRenderedHTML(productUrl);
      const { product, needsAiSelectors } = await extractProductData(html, productUrl);

      if (product) {
        results.push(product);
        scrapedItems.push({ product, rawHtml: html, url: productUrl });
        logger.info({
          message: 'Product scraped',
          service: 'scraper',
          url: productUrl
        });
      } else {
        logger.warn({
          message: 'Product extraction incomplete',
          service: 'scraper',
          url: productUrl,
          needsAiSelectors: Boolean(needsAiSelectors)
        });
      }
    } catch (error) {
      logger.error({
        message: 'Product scrape failed',
        service: 'scraper',
        url: productUrl,
        error: error?.message || String(error)
      });
    }
  }

  logger.info({
    message: 'Scrape completed',
    service: 'scraper',
    url: storeUrl,
    total: limitedUrls.length,
    success: results.length
  });

  if (pipelineStoreId) {
    await runScraperProductPipeline(scrapedItems, pipelineStoreId);
  } else {
    logger.warn({
      message: 'Skipping scraper persistence due to missing storeId',
      service: 'scraper',
      url: storeUrl
    });
  }

  return results;
}

module.exports = { scrapeStore };
