const cheerio = require('cheerio');
const { chromium } = require('playwright');
const logger = require('../logger.service');
const { fetchRenderedHTML } = require('./playwright.service');

const PRODUCT_URL_REGEX = /\/(product|products|p|item|items|dp|shop|buy|pd|detail|goods)(\/|$)/i;
const EXCLUDED_URL_REGEX = /\/(cart|checkout|account|login|register|wishlist|category|collection|blog|about|contact|search|page|tag|shop\/women|shop\/men|shop\/new|shop\/all)\b/i;
const NEXT_TEXT_REGEX = /(next|next page|\u2192|\u00bb|>)/i;
const LOAD_MORE_REGEX = /(load more|show more|view more|see more)/i;
const DATA_ATTRS = ['data-product-id', 'data-sku', 'data-item-id'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch (error) {
    void error;
    return null;
  }
}

function isSkippableHref(href) {
  if (!href) {
    return true;
  }
  const trimmed = href.trim().toLowerCase();
  return (
    trimmed === '#' ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('mailto:')
  );
}

function isExcludedUrl(url) {
  if (!url) {
    return true;
  }
  return EXCLUDED_URL_REGEX.test(url);
}

function looksLikeProductUrl(url) {
  if (!url) {
    return false;
  }
  return PRODUCT_URL_REGEX.test(url);
}

function hasProductIndicators($, el) {
  const hasImage = $(el).find('img').length > 0;
  const hasDataAttr = DATA_ATTRS.some((attr) => $(el).attr(attr));
  const hasAncestorDataAttr = $(el)
    .closest(DATA_ATTRS.map((attr) => `[${attr}]`).join(','))
    .length > 0;

  return hasImage || hasDataAttr || hasAncestorDataAttr;
}

function isSameDomain(url, baseUrl) {
  try {
    const urlDomain = new URL(url).hostname.replace('www.', '');
    const baseDomain = new URL(baseUrl).hostname.replace('www.', '');
    return urlDomain === baseDomain;
  } catch {
    return false;
  }
}

function getNextPageFromQuery(baseUrl) {
  try {
    const url = new URL(baseUrl);
    const pageParam = url.searchParams.get('page');
    const currentPage = pageParam ? Number.parseInt(pageParam, 10) : null;
    if (Number.isFinite(currentPage)) {
      url.searchParams.set('page', String(currentPage + 1));
      return url.toString();
    }
  } catch (error) {
    void error;
  }
  return null;
}

function getNextPageFromPath(baseUrl) {
  const match = String(baseUrl).match(/\/page\/(\d+)(\/|$)/i);
  if (!match) {
    return null;
  }

  const currentPage = Number.parseInt(match[1], 10);
  if (!Number.isFinite(currentPage)) {
    return null;
  }

  return String(baseUrl).replace(/\/page\/(\d+)(\/|$)/i, `/page/${currentPage + 1}/`);
}

function getNextPageFromPagination($, baseUrl) {
  const candidates = [];

  $('a').each((_, el) => {
    const text = $(el).text().trim();
    if (!/^\d+$/.test(text)) {
      return;
    }
    const href = $(el).attr('href');
    if (!href) {
      return;
    }
    candidates.push({
      number: Number.parseInt(text, 10),
      href,
      isCurrent:
        $(el).attr('aria-current') === 'page' ||
        $(el).hasClass('active') ||
        $(el).hasClass('current')
    });
  });

  if (candidates.length === 0) {
    return null;
  }

  const current = candidates.find((entry) => entry.isCurrent);
  if (!current) {
    return null;
  }

  const next = candidates.find((entry) => entry.number === current.number + 1);
  if (!next) {
    return null;
  }

  return resolveUrl(next.href, baseUrl);
}

function resolveNextPageUrl($, baseUrl, visitedUrls) {
  const isVisited = (candidate) =>
    candidate && visitedUrls instanceof Set && visitedUrls.has(candidate);

  const relNext =
    $('link[rel="next"]').attr('href') || $('a[rel="next"]').attr('href');
  if (relNext) {
    const resolved = resolveUrl(relNext, baseUrl);
    if (resolved && !isVisited(resolved)) {
      return resolved;
    }
  }

  let nextTextLink = null;
  $('a[href]').each((_, el) => {
    const text = $(el).text().trim();
    if (!text || !NEXT_TEXT_REGEX.test(text)) {
      return;
    }
    const href = $(el).attr('href');
    if (!href) {
      return;
    }
    nextTextLink = resolveUrl(href, baseUrl);
  });
  if (nextTextLink && !isVisited(nextTextLink)) {
    return nextTextLink;
  }

  const queryNext = getNextPageFromQuery(baseUrl);
  if (queryNext && !isVisited(queryNext)) {
    return queryNext;
  }

  const pathNext = getNextPageFromPath(baseUrl);
  if (pathNext && !isVisited(pathNext)) {
    return pathNext;
  }

  const numericNext = getNextPageFromPagination($, baseUrl);
  if (numericNext && !isVisited(numericNext)) {
    return numericNext;
  }

  return null;
}

async function getProductUrlsFromListing(pageHTML, baseUrl, visitedUrls = new Set()) {
  const $ = cheerio.load(pageHTML || '');
  const productUrls = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (isSkippableHref(href)) {
      return;
    }

    const resolved = resolveUrl(href, baseUrl);
    if (!resolved || isExcludedUrl(resolved)) {
      return;
    }

    if (isSameDomain(resolved, baseUrl) && (looksLikeProductUrl(resolved) || hasProductIndicators($, el))) {
        productUrls.add(resolved);
    }
  });

  const nextPageUrl = resolveNextPageUrl($, baseUrl, visitedUrls);

  return {
    productUrls: Array.from(productUrls),
    nextPageUrl: nextPageUrl || null
  };
}

async function handleDynamicPagination(page, baseUrl) {
  const productUrls = new Set();
  let previousCount = 0;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const html = await page.content();
    const { productUrls: pageUrls } = await getProductUrlsFromListing(html, baseUrl);
    pageUrls.forEach((url) => productUrls.add(url));

    const buttons = page.locator('button, a', { hasText: LOAD_MORE_REGEX });
    const count = await buttons.count();
    if (count === 0) {
      break;
    }

    const button = buttons.first();
    try {
      await button.click();
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch (error) {
      logger.warn({
        message: 'Dynamic pagination click failed',
        service: 'scraper',
        url: baseUrl,
        error: error?.message || String(error)
      });
      break;
    }

    if (productUrls.size === previousCount) {
      break;
    }
    previousCount = productUrls.size;
  }

  return Array.from(productUrls);
}

async function crawlListingPages(startUrl, options = {}) {
  const maxPages = Number.isFinite(options.maxPages) ? options.maxPages : 10;
  const maxProducts = Number.isFinite(options.maxProducts) ? options.maxProducts : 500;
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 1500;
  const visited = new Set();
  const productUrls = new Set();
  let nextPageUrl = startUrl;
  let pagesVisited = 0;
  let usedDynamicPagination = false;

  while (
    nextPageUrl &&
    pagesVisited < maxPages &&
    productUrls.size < maxProducts
  ) {
    if (visited.has(nextPageUrl)) {
      break;
    }

    visited.add(nextPageUrl);
    pagesVisited += 1;

    try {
      const html = await fetchRenderedHTML(nextPageUrl);
      const { productUrls: pageUrls, nextPageUrl: detectedNext } =
        await getProductUrlsFromListing(html, nextPageUrl, visited);

      pageUrls.forEach((url) => {
        if (productUrls.size < maxProducts) {
          productUrls.add(url);
        }
      });

      if (pagesVisited === 1 && pageUrls.length === 0) {
        usedDynamicPagination = true;
        let browser;
        try {
          browser = await chromium.launch({ headless: true });
          const page = await browser.newPage();
          await page.goto(startUrl, { waitUntil: 'networkidle', timeout: 30000 });
          const dynamicUrls = await handleDynamicPagination(page, startUrl);
          dynamicUrls.forEach((url) => {
            if (productUrls.size < maxProducts) {
              productUrls.add(url);
            }
          });
          await page.close();
        } catch (error) {
          logger.warn({
            message: 'Dynamic pagination failed',
            service: 'scraper',
            url: startUrl,
            error: error?.message || String(error)
          });
        } finally {
          if (browser) {
            await browser.close();
          }
        }
      }

      logger.info({
        message: 'Listing crawl progress',
        service: 'scraper',
        page: pagesVisited,
        urlsFound: pageUrls.length,
        totalSoFar: productUrls.size,
        nextPage: detectedNext || null
      });

      nextPageUrl = detectedNext && !visited.has(detectedNext) ? detectedNext : null;
    } catch (error) {
      logger.warn({
        message: 'Listing page crawl failed',
        service: 'scraper',
        url: nextPageUrl,
        error: error?.message || String(error)
      });
      break;
    }

    if (nextPageUrl && productUrls.size < maxProducts) {
      await sleep(Math.max(delayMs, 1500));
    }
  }

  const result = Array.from(productUrls);
  result.pagesVisited = pagesVisited;
  result.usedDynamicPagination = usedDynamicPagination;
  return result;
}

module.exports = {
  getProductUrlsFromListing,
  handleDynamicPagination,
  crawlListingPages
};
