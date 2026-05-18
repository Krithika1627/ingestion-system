const cheerio = require('cheerio');

const PRODUCT_URL_REGEX = /\/(product|products|p|item|dp)\//i;

function isProductUrl(url) {
  return PRODUCT_URL_REGEX.test(url);
}

function resolveUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch (error) {
    return null;
  }
}

async function getProductUrlsFromListing(pageHTML, baseUrl) {
  const $ = cheerio.load(pageHTML || '');
  const productUrls = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const resolved = resolveUrl(href, baseUrl);
    if (resolved && isProductUrl(resolved)) {
      productUrls.add(resolved);
    }
  });

  let nextPageUrl = null;
  const relNext = $('a[rel="next"]').attr('href') || $('link[rel="next"]').attr('href');
  if (relNext) {
    nextPageUrl = resolveUrl(relNext, baseUrl);
  }

  if (!nextPageUrl) {
    const nextCandidate = $('a[href*="page="], a[href*="/page/"]').first().attr('href');
    if (nextCandidate) {
      nextPageUrl = resolveUrl(nextCandidate, baseUrl);
    }
  }

  return {
    productUrls: Array.from(productUrls),
    nextPageUrl: nextPageUrl || null
  };
}

module.exports = { getProductUrlsFromListing };
