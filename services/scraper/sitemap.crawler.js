const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const logger = require('../logger.service');

const SITEMAP_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap.txt'];
const PRODUCT_URL_REGEX = /\/(product|products|p|item|dp)\//i;
const EXCLUDED_PATTERNS = [
  '/reviews',
  '/blog',
  '/blogs',
  '/collection',
  '/collections',
  '/search',
  '/cart',
  '/account',
  '?id='
];

function isProductUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  const lower = url.toLowerCase();

  const looksLikeProduct = PRODUCT_URL_REGEX.test(lower);

  const excluded = EXCLUDED_PATTERNS.some((pattern) =>
    lower.includes(pattern)
  );

  return looksLikeProduct && !excluded;
}

function parseXml(xmlText) {
  const parser = new XMLParser({ ignoreAttributes: false });
  return parser.parse(xmlText);
}

function extractLocs(entries) {
  if (!entries) {
    return [];
  }
  const list = Array.isArray(entries) ? entries : [entries];
  return list
    .map((entry) => entry?.loc)
    .filter(Boolean);
}

async function fetchSitemap(url) {
  const response = await axios.get(url, { timeout: 15000 });
  const contentType = response?.headers?.['content-type'] || '';
  const text = response?.data || '';

  if (typeof text !== 'string') {
    return [];
  }

  if (url.endsWith('.txt') || contentType.includes('text/plain')) {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const parsed = parseXml(text);
  const urlset = parsed?.urlset?.url || null;
  const sitemapindex = parsed?.sitemapindex?.sitemap || null;
  const urls = extractLocs(urlset);
  const sitemaps = extractLocs(sitemapindex);

  if (sitemaps.length > 0) {
    const nestedUrls = [];
    for (const sitemapUrl of sitemaps) {
      try {
        const nested = await fetchSitemap(sitemapUrl);
        nestedUrls.push(...nested);
      } catch (error) {
        logger.warn({
          message: 'Failed to fetch nested sitemap',
          service: 'scraper',
          url: sitemapUrl,
          error: error?.message || String(error)
        });
      }
    }
    return nestedUrls;
  }

  return urls;
}

async function getSitemapUrls(domain) {
  const base = new URL(domain);
  const productUrls = new Set();

  for (const path of SITEMAP_PATHS) {
    const sitemapUrl = new URL(path, base).toString();
    try {
      const urls = await fetchSitemap(sitemapUrl);
      urls.filter(isProductUrl).forEach((url) => productUrls.add(url));
      if (productUrls.size > 0) {
        logger.info({
          message: 'Sitemap product URLs found',
          service: 'scraper',
          url: sitemapUrl,
          count: productUrls.size
        });
        break;
      }
    } catch (error) {
      logger.warn({
        message: 'Sitemap fetch failed',
        service: 'scraper',
        url: sitemapUrl,
        error: error?.message || String(error)
      });
    }
  }

  return Array.from(productUrls);
}

module.exports = { getSitemapUrls };
