const axios = require('axios');
const { chromium } = require('playwright');
const logger = require('../logger.service');

const DEFAULT_TIMEOUT_MS = 30000;

function hasProductJsonLd(html) {
  if (typeof html !== 'string') {
    return false;
  }

  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match = scriptRegex.exec(html);
  while (match) {
    const raw = match[1] || '';
    if (raw.includes('"@type"') && raw.toLowerCase().includes('product')) {
      return true;
    }
    match = scriptRegex.exec(html);
  }
  return false;
}

async function fetchRenderedHTML(url, options = {}) {
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;

  try {
    const response = await axios.get(url, { timeout: Math.min(timeoutMs, 15000) });
    const html = response?.data;
    if (typeof html === 'string' && hasProductJsonLd(html)) {
      logger.info({
        message: 'Scraper fast-path JSON-LD hit',
        service: 'scraper',
        url
      });
      return html;
    }
  } catch (error) {
    logger.warn({
      message: 'Scraper fast-path request failed',
      service: 'scraper',
      url,
      error: error?.message || String(error)
    });
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(2000);
    const content = await page.content();
    await page.close();
    await context.close();
    return content;
  } catch (error) {
    logger.error({
      message: 'Scraper render failed',
      service: 'scraper',
      url,
      error: error?.message || String(error)
    });
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { fetchRenderedHTML };
