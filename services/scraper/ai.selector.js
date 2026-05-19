const axios = require('axios');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const logger = require('../logger.service');
const { connectDB } = require('../db.service');
require('dotenv').config();

const GEMINI_MODEL = 'gemini-2.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const ALLOWED_TAGS = new Set([
  'main', 'article', 'div', 'section',
  'h1', 'h2', 'h3', 'p', 'span', 'img',
  'button', 'ul', 'li', 'a', 'form',
  'select', 'option', 'input', 'label'
]);

const SYSTEM_PROMPT =
  'You are an expert at analyzing e-commerce product page HTML and ' +
  'identifying CSS selectors. You always respond with valid JSON only, ' +
  'no markdown, no explanation.';

const SelectorCacheSchema = new mongoose.Schema(
  {
    domain: { type: String, required: true, unique: true },
    selectors: {
      title: String,
      price: String,
      images: String,
      availability: String,
      variants: String
    },
    createdAt: { type: Date, default: Date.now },
    source: { type: String, default: 'gemini' }
  },
  { collection: 'selector_cache', versionKey: false }
);

const SelectorCache =
  mongoose.models.SelectorCache ||
  mongoose.model('SelectorCache', SelectorCacheSchema);

function stripComments(html) {
  if (!html) {
    return '';
  }
  return String(html).replace(/<!--[\s\S]*?-->/g, '');
}

function sanitizeHtml(html) {
  const withoutComments = stripComments(html);
  const $ = cheerio.load(withoutComments);

  $('script, style, nav, footer, header, iframe, noscript').remove();

  $('*').each((_, el) => {
    const attribs = el.attribs || {};
    Object.keys(attribs).forEach((attr) => {
      const lowered = attr.toLowerCase();
      if (lowered === 'style' || lowered.startsWith('on')) {
        $(el).removeAttr(attr);
      }
    });
  });

  // Try to find main product container first
  const productSelectors = [
    '[data-testid="pdp"]',
    '[data-testid="product"]', 
    '.product-detail',
    '.product-page',
    '#product-detail',
    'main',
    'article'
  ];

  let content = '';
  for (const sel of productSelectors) {
    const el = $(sel);
    if (el.length > 0) {
      content = el.html() || '';
      break;
    }
  }

  // Fall back to full HTML if no product container found
  if (!content) {
    content = $.root().html() || '';
  }

  return content.length > 15000 ? content.slice(0, 15000) : content;
}

function buildUserPrompt(cleanedHtml) {
  return (
    'Analyze this e-commerce product page HTML and return CSS selectors ' +
    'for these fields: title, price, images, availability, variants.\n\n' +
    'Rules:\n' +
    '- Return GENERIC selectors that work for ALL products on this site, ' +
    'not selectors specific to this one product (avoid selectors containing ' +
    'product names, IDs, or slugs in attribute values)\n' +
    '- Return ONLY a JSON object, no markdown backticks\n' +
    '- Use the most specific and reliable selector for each field\n' +
    '- Prefer selectors with semantic meaning (h1, [itemprop], data- attrs)\n' +
    '- If a field cannot be found return null for that field\n' +
    '- images should be an array selector (the container, not individual imgs)\n\n' +
    'Return format:\n' +
    '{\n' +
    '  title: string | null,\n' +
    '  price: string | null,\n' +
    '  images: string | null,\n' +
    '  availability: string | null,\n' +
    '  variants: string | null\n' +
    '}\n\n' +
    'HTML:\n' +
    cleanedHtml
  );
}

async function callGemini(prompt, url, attempt = 1) {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    logger.error({
      message: 'GEMINI_API_KEY is not configured',
      service: 'scraper',
      url
    });
    return null;
  }

  const endpoint = `${API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  try {
    const response = await axios.post(
      endpoint,
      {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      },
      { timeout: 30000 }
    );

    const text =
      response?.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    return text;
  } catch (error) {
    const status = error?.response?.status;
    if (status === 429 && attempt === 1) {
    console.log('Gemini full error response:', error.response?.data);

      logger.warn({
        message: 'Gemini rate limit hit, retrying',
        service: 'scraper',
        url
      });
      await new Promise((resolve) => setTimeout(resolve, 10000));
      return callGemini(prompt, url, attempt + 1);
    }

    logger.error({
      message: 'Gemini selector request failed',
      service: 'scraper',
      url,
      status: status || null,
      error: error?.message || String(error)
    });
    return null;
  }
}

function parseSelectorResponse(raw, url) {
  if (!raw) {
    return null;
  }

  const trimmed = String(raw).trim();
  try {
    // Strip markdown code fences Gemini 2.5 adds despite instructions
    const cleaned = trimmed
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();
    return JSON.parse(cleaned);  // ← change trimmed to cleaned
  } catch (error) {
    void error;
    logger.error({
      message: 'Gemini selector JSON parse failed',
      service: 'scraper',
      url,
      rawResponse: trimmed
    });
    return null;
  }
}

function validateSelectors(selectors, originalHtml) {
  if (!selectors || typeof selectors !== 'object') {
    return null;
  }

  const $ = cheerio.load(originalHtml || '');
  const fields = ['title', 'price', 'images', 'availability', 'variants'];
  const validated = {};

  fields.forEach((field) => {
    const value = selectors[field];
    if (typeof value !== 'string') {
      validated[field] = null;
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      validated[field] = null;
      return;
    }
    try {
      const count = $(trimmed).length;
      validated[field] = count > 0 ? trimmed : null;
    } catch (error) {
      void error;
      validated[field] = null;
    }
  });

  // title fallback
  if (!validated.title) {
    const titleFallbacks = [
      'h1',
      '[data-testid="product-title"]',
      '[data-testid="pdp-title"]',
      '.product-title',
      '.product-name',
      'h1.title'
    ];
    
    for (const fallback of titleFallbacks) {
      if ($(fallback).length > 0) {
        validated.title = fallback;
        break;
      }
    }
  }

  const hasAny = Object.values(validated).some((value) => value);
  return hasAny ? validated : null;
}

async function saveSelectors(domain, selectors) {
  if (!domain || !selectors) {
    return;
  }

  await connectDB();
  await SelectorCache.updateOne(
    { domain },
    {
      $set: {
        domain,
        selectors,
        createdAt: new Date(),
        source: 'gemini'
      }
    },
    { upsert: true }
  );
}

async function generateSelectors(html, url) {
  try {
    const domain = new URL(url).hostname;
    const cleanedHtml = sanitizeHtml(html || '');
    
    console.log('1. cleanedHtml length:', cleanedHtml.length);  // ADD
    
    const prompt = buildUserPrompt(cleanedHtml);
    const rawResponse = await callGemini(prompt, url, 1);
    
    console.log('2. rawResponse:', rawResponse);  // ADD
    
    const parsed = parseSelectorResponse(rawResponse, url);
    
    console.log('3. parsed:', parsed);  // ADD
    
    const validated = validateSelectors(parsed, html || '');
    
    console.log('4. validated:', validated);  // ADD

    if (!validated) {
      return null;
    }

    await saveSelectors(domain, validated);
    return validated;
  } catch (error) {
    logger.error({
      message: 'Gemini selector generation failed',
      service: 'scraper',
      url,
      error: error?.message || String(error)
    });
    return null;
  }
}

module.exports = { generateSelectors };
