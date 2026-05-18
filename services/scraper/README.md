# Scraper Service Layer

This folder contains a generic scraping engine for sites that do not expose APIs. The flow is:

1) `scraper.orchestrator.js` calls the sitemap crawler or listing crawler to discover product URLs.
2) Each product URL is rendered with Playwright when needed.
3) The extractor normalizes data into the canonical schema shape used by the ingestion engine.

## Files

- `playwright.service.js`
  - Renders pages with Playwright and returns full HTML.
  - Uses a fast-path axios request when JSON-LD is present.

- `extractor.service.js`
  - Extracts product data using JSON-LD, Open Graph, or cached selectors.
  - Normalizes fields and returns a canonical product object or a flag for AI selectors.

- `price.normalizer.js`
  - Parses price strings like "USD 12.99", "12.99 INR", or "Rs. 499".
  - Returns `{ amount, currency }` with USD fallback.

- `sitemap.crawler.js`
  - Fetches `/sitemap.xml`, `/sitemap_index.xml`, or `/sitemap.txt`.
  - Extracts and filters product URLs.

- `listing.crawler.js`
  - Extracts product URLs and a next-page URL from a listing page HTML.

- `scraper.orchestrator.js`
  - Main entry point that coordinates sitemap discovery, scraping, extraction, and delays.

## Selector Cache Schema

Selectors are stored in MongoDB as:

```
{ domain, selectors: { title, price, images, availability, variants }, createdAt }
```

## Installation

Install the scraper dependencies:

```
npm install playwright cheerio fast-xml-parser
```

Install Playwright browser binaries:

```
npx playwright install chromium
```

## Usage

```
const { scrapeStore } = require('./services/scraper/scraper.orchestrator');

const products = await scrapeStore('https://example.com');
```
