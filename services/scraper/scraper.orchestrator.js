const logger = require('../logger.service');
const { fetchRenderedHTML } = require('./playwright.service');
const { extractProductData } = require('./extractor.service');
const { getSitemapUrls } = require('./sitemap.crawler');
const { crawlListingPages } = require('./listing.crawler');
const { runScraperProductPipeline } = require('./scraper.pipeline');
const { fingerprintStore } = require('./store.fingerprint');

const TEST_SCRAPE_LIMIT = 10;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDelayMs() {
  return 1000 + Math.floor(Math.random() * 1000);
}

async function scrapeStore(storeUrl, options) {
  const isOptionsObject = options && typeof options === 'object';
  const explicitStoreId = !isOptionsObject && typeof options === 'string'
    ? options
    : isOptionsObject
      ? options.storeId
      : null;
  const listingOptions = isOptionsObject ? options : {};

  const fingerprint = await fingerprintStore(storeUrl);
  const detectedPlatform = fingerprint?.platform || fingerprint?.detectedPlatform || 'unknown';
  const pipelineStoreId =
    fingerprint?.id || explicitStoreId || process.env.SCRAPER_STORE_ID || null;

  const knownPlatforms = new Set(['shopify', 'magento', 'woocommerce', 'bigcommerce']);
  if (knownPlatforms.has(detectedPlatform)) {
    logger.warn({
      message: 'Known platform detected via scraper — consider switching to API connector',
      service: 'scraper',
      url: storeUrl,
      platform: detectedPlatform,
      storeId: pipelineStoreId || null
    });
    logger.warn({
      message: 'Known platform detected, scraper skipped. Use platform connector for this store.',
      service: 'scraper',
      url: storeUrl,
      platform: detectedPlatform,
      storeId: pipelineStoreId || null
    });
    return {
      skipped: true,
      reason: 'known_platform',
      platform: detectedPlatform,
      storeId: pipelineStoreId || null,
      mode: 'api',
      message: `Use ${detectedPlatform} API connector instead`
    };
  }

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
    logger.warn({
      message: 'No sitemap found, falling back to listing crawler',
      service: 'scraper',
      url: storeUrl
    });
    const listingResult = await crawlListingPages(storeUrl, listingOptions);
    productUrls = Array.isArray(listingResult) ? listingResult : [];
  }

  if (productUrls.length === 0) {
    logger.warn({
      message: 'Could not discover product URLs for this store',
      service: 'scraper',
      url: storeUrl
    });
    return [];
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
        if (pipelineStoreId) {
          product.storeId = pipelineStoreId;
        }
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
