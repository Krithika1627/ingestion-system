# Connector Documentation — Commerce Integration & Data Ingestion Engine

**Version:** 1.0.0  
**Last Updated:** June 2026

This document describes how each platform connector works, how authentication is configured, what data is fetched, known limitations, and how to add a new store.

---

## Table of Contents

1. [Shopify](#1-shopify)
2. [Magento](#2-magento)
3. [WooCommerce](#3-woocommerce)
4. [BigCommerce](#4-bigcommerce)
5. [Unicommerce](#5-unicommerce)
6. [Generic Website Scraper](#6-generic-website-scraper)
7. [Adding a New Store](#7-adding-a-new-store)

---

## 1. Shopify

**Status:** ✅ Live (real API)  
**Protocol:** GraphQL  
**Auth method:** Access Token

### Authentication

Shopify uses a private app access token loaded from `.env`:

```env
SHOPIFY_STORE_URL=https://your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxx
```

To get your access token:
1. Go to your Shopify Partner Dashboard → your dev store
2. Settings → Apps and sales channels → Develop apps
3. Create a private app → Admin API access scopes → enable `read_products`, `read_inventory`
4. Install the app → copy the Admin API access token

### What is Fetched

| Data | API Used | Notes |
|---|---|---|
| Products | `POST /admin/api/graphql.json` | GraphQL with cursor-based pagination |
| Variants | Included in product query | Price, SKU, inventory per variant |
| Collections (categories) | GraphQL collections query | Fetched separately, linked to products |
| Inventory | Included in variant query | `inventoryQuantity` per variant |

### Sync Endpoints

| Endpoint | What it does |
|---|---|
| `POST /sync/shopify/products` | Sync products only |
| `POST /sync/shopify/categories` | Sync collections only |
| `POST /sync/shopify` | Full sync (categories then products) |
| `POST /scheduler/sync/:storeId` | Trigger via scheduler (respects incremental sync) |

### Scheduler

Shopify supports scheduled automatic sync via node-cron. Default frequency: every 6 hours.

```bash
# Add Shopify store to scheduler
curl -X POST http://localhost:3000/scheduler/add \
  -H "Content-Type: application/json" \
  -d '{
    "storeId": "store_shopify_001",
    "platform": "shopify",
    "cronExpression": "0 */6 * * *"
  }'
```

### Webhook Support

Shopify webhooks are supported for real-time updates. Endpoint: `POST /webhooks/shopify/:storeId`

Supported topics:
- `products/create` → ingests new product
- `products/update` → updates existing product
- `products/delete` → marks product inactive

HMAC signature verification is enforced. Replay protection via 24h dedup window and 5-minute timestamp check.

To register a webhook in Shopify:
1. Shopify Admin → Settings → Notifications → Webhooks
2. Set URL to `https://your-domain.com/webhooks/shopify/store_shopify_001`
3. Select topic and save

### Incremental Sync

Shopify supports server-side delta filtering via `updatedAtMin` in the GraphQL query. Only products updated since `lastSyncedAt` are fetched on subsequent syncs.

### Rate Limiting

Shopify uses a point-based throttle system. The connector reads `extensions.cost.throttleStatus.currentlyAvailable` and pauses when points drop below 200. Exponential backoff on failures.

### Known Limitations

- Collections must be fetched before products — pipeline dependency
- Shopify GraphQL GID format (`gid://shopify/Product/xxx`) is kept as `sourceId`
- `productType` field in Shopify maps to `category` in canonical schema (not `productType`)
- Draft and archived products are ingested but marked as `inactive`

---

## 2. Magento

**Status:** ⚠️ Mock mode (real API architecture built, credentials unavailable)  
**Protocol:** REST  
**Auth method:** OAuth Bearer Token

### Authentication

```env
MAGENTO_STORE_URL=https://your-magento-store.com
MAGENTO_ACCESS_TOKEN=your_bearer_token_here
```

To get credentials:
- Magento Admin → System → Integrations → Add Integration
- Set resource access to: `Catalog > Products`, `Catalog > Categories`
- Activate → copy the Access Token

### What is Fetched

| Data | Endpoint | Notes |
|---|---|---|
| Products | `GET /rest/V1/products` | Page-based pagination |
| Categories | `GET /rest/V1/categories` | Must run before products |
| Stock | Included in product via `extension_attributes.stock_item` | Per product |

### Sync Endpoints

| Endpoint | What it does |
|---|---|
| `POST /sync/magento/products` | Sync products only |
| `POST /sync/magento/categories` | Sync category tree only |
| `POST /sync/magento` | Full sync |

### Incremental Sync

Magento supports `updated_at` filtering via `searchCriteria`:
```
searchCriteria[filter_groups][0][filters][0][field]=updated_at
searchCriteria[filter_groups][0][filters][0][value]=<ISO timestamp>
searchCriteria[filter_groups][0][filters][0][condition_type]=gteq
```

### Known Limitations

- **Real API not tested** — integration built and validated against mock datasets only. Real credentials were unavailable during development.
- Category tree must be fetched first — products reference `category_id` which must be resolved
- Brand is stored in `custom_attributes` — not a top-level field
- Images use relative paths — must prepend `storeBaseUrl/pub/media/catalog/product`
- Disabled images (`disabled: true`) are filtered out
- Status `1` = active, `2` = inactive (number enum, not string)
- Categories at `level 0` and `level 1` are internal system nodes — skipped

---

## 3. WooCommerce

**Status:** ⚠️ Mock mode (connector built, LocalWP auth returning 401)  
**Protocol:** REST  
**Auth method:** Basic Auth (Consumer Key + Consumer Secret)

### Authentication

```env
WOOCOMMERCE_STORE_URL=https://your-woo-store.com
WOOCOMMERCE_CONSUMER_KEY=ck_xxxxxxxxxxxxxxxxxxxx
WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxxxxxxxxxxxxxxxxx
```

To get credentials:
- WordPress Admin → WooCommerce → Settings → Advanced → REST API
- Add Key → set permissions to Read → Generate API Key
- Copy Consumer Key and Consumer Secret

### What is Fetched

| Data | Endpoint | Notes |
|---|---|---|
| Products | `GET /wp-json/wc/v3/products` | Page-based pagination |
| Categories | `GET /wp-json/wc/v3/products/categories` | Separate fetch |
| Variations | `GET /wp-json/wc/v3/products/:id/variations` | Only for `type: "variable"` products |

### Sync Endpoints

| Endpoint | What it does |
|---|---|
| `POST /sync/woocommerce/products` | Sync products only |
| `POST /sync/woocommerce/categories` | Sync categories only |
| `POST /sync/woocommerce` | Full sync |
| `POST /scheduler/sync/:storeId` | Trigger via scheduler |

### Scheduler

WooCommerce supports scheduled sync. Default frequency: every 6 hours.

### Webhook Support

WooCommerce webhooks are supported. Endpoint: `POST /webhooks/woocommerce/:storeId`

Supported topics:
- `product.created`
- `product.updated`
- `product.deleted`

HMAC signature verified via `X-WC-Webhook-Signature` header. Duplicate delivery protection via 24h dedup window.

### Incremental Sync

WooCommerce REST API supports `after` query param:
```
GET /wp-json/wc/v3/products?after=<ISO timestamp>
```
Only products modified after `lastSyncedAt` are fetched.

### Known Limitations

- **Live API not tested** — LocalWP returns 401 despite valid credentials. Mock mode fallback enabled.
- Brand is not a standard WooCommerce field — requires a third-party plugin (e.g. Perfect Brands for WooCommerce). If plugin not installed, `brand` will be `null`.
- Variable products require a second API call to fetch variations
- `stock_quantity` may be `null` when `manage_stock: false` — availability derived from `stock_status` instead
- HTML tags in description must be stripped before storing
- `sale_price` is an empty string when not on sale — check `on_sale === true` before using it

---

## 4. BigCommerce

**Status:** ✅ Live (real API)  
**Protocol:** REST  
**Auth method:** API Key + Client ID

### Authentication

```env
BIGCOMMERCE_STORE_HASH=your_store_hash
BIGCOMMERCE_CLIENT_ID=your_client_id
BIGCOMMERCE_ACCESS_TOKEN=your_access_token
```

To get credentials:
1. BigCommerce Control Panel → Advanced Settings → API Accounts
2. Create API Account → set scope: `Products (read-only)`, `Content (read-only)`
3. Copy Store Hash, Client ID, and Access Token

### What is Fetched

| Data | Endpoint | Notes |
|---|---|---|
| Products | `GET /v2/catalog/products` | Page-based pagination |
| Brands | `GET /v2/brands/:id` | Fetched per product — `brand_id` resolved to name |
| Categories | `GET /v2/catalog/trees/{id}/categories` | Full tree fetched once |
| Variants | Included in product response | `?include=variants` param |

### Sync Endpoints

| Endpoint | What it does |
|---|---|
| `POST /sync/bigcommerce/products` | Sync products only |
| `POST /sync/bigcommerce/categories` | Sync category tree only |
| `POST /sync/bigcommerce` | Full sync |

### Incremental Sync

BigCommerce supports `date_modified:min` filter:
```
GET /v2/catalog/products?date_modified:min=<ISO timestamp>
```

### Known Limitations

- Brand requires a separate API call per product (`brand_id` → `GET /v2/brands/:id`) — cannot be resolved from the product response alone
- Category IDs must be resolved via the category tree API
- Dates are in RFC 2822 format (`Mon, 15 Jan 2024 10:00:00 +0000`) — converted to ISO 8601 during transformation
- `retail_price === price` means no discount — `compareAtPrice` set to `null`
- `search_keywords` (comma-separated string) is used as `tags`
- `inventory_tracking` can be `"product"` or `"variant"` — affects which inventory level to use

---

## 5. Unicommerce

**Status:** ⚠️ Mock mode (inventory connector built, real credentials unavailable)  
**Protocol:** REST  
**Auth method:** OAuth 2.0

### Authentication

```env
UNICOMMERCE_BASE_URL=https://your-tenant.unicommerce.com
UNICOMMERCE_USERNAME=your_username
UNICOMMERCE_PASSWORD=your_password
UNICOMMERCE_CLIENT_ID=your_client_id
```

OAuth flow: POST to `/oauth/token` with credentials → get Bearer token → use in all requests.

### What is Fetched

| Data | Endpoint | Notes |
|---|---|---|
| Product catalog | `/catalog/itemType/get` | SKU-level product data |
| Inventory snapshot | `/inventorySnapshot/get` | Stock levels per SKU per facility |

Inventory is merged with product data on `skuCode` to produce the canonical record.

### Sync Endpoints

| Endpoint | What it does |
|---|---|
| `POST /sync/unicommerce/inventory` | Sync inventory only |
| `POST /sync/unicommerce` | Full sync |

### Incremental Sync

Unicommerce does not support server-side delta filtering. Full fetch on every sync — results filtered in memory by `updatedAt` field where available.

### Known Limitations

- **Real API not tested** — requires enterprise credentials and sandbox access
- Order API integration pending real credentials
- Unicommerce is an OMS/inventory platform — it does not create products, only updates existing offer inventory
- `inventory` field is GROSS inventory — always subtract `blockedInventory` to get available quantity: `availableQty = inventory - blockedInventory`
- `createdAt` and `updatedAt` are not available in Unicommerce responses
- Does not support webhooks — polling only

---

## 6. Generic Website Scraper

**Status:** ✅ Live (tested on Mamaearth, Bewakoof)  
**Protocol:** HTTP scraping (Playwright + Cheerio)  
**Auth method:** None (public pages only)

### How it Works

The scraper uses a 4-level extraction fallback chain:

```
1. JSON-LD structured data  (fastest — no rendering needed)
         ↓ if not found
2. Open Graph meta tags
         ↓ if not found
3. Cached CSS selectors  (domain-specific selectors stored in MongoDB)
         ↓ if not found
4. AI-generated selectors  (Gemini 2.5 Flash generates selectors for unknown sites)
```

### Dependencies

```bash
npm install playwright cheerio fast-xml-parser
npx playwright install chromium
```

### Configuration

```env
GEMINI_API_KEY=your_gemini_api_key
```

No per-store credentials needed — works on any publicly accessible e-commerce site.

### Usage

```javascript
const { scrapeStore } = require('./services/scraper/scraper.orchestrator');
const products = await scrapeStore('https://example.com');
```

### What is Fetched

Product URLs are discovered via:
1. `sitemap.xml` or `sitemap_index.xml` — preferred, faster
2. Listing page crawler with pagination — fallback for sites without sitemaps

Per product page, the scraper extracts:
- Title, price, currency, availability
- Images, description
- Variants (if detectable)
- Brand, category (from structured data or page context)

### Sync Endpoints

| Endpoint | What it does |
|---|---|
| `POST /sync/scraper` | Scrape a store by URL |

Body:
```json
{ "url": "https://example.com" }
```

### Selector Cache

AI-generated CSS selectors are cached per domain in MongoDB to avoid repeated Gemini API calls:

```json
{
  "domain": "mamaearth.in",
  "selectors": {
    "title": "h1.product-title",
    "price": "span.price",
    "images": "img.product-image",
    "availability": "div.stock-status",
    "variants": "div.variant-option"
  },
  "createdAt": "2026-06-01T09:00:00Z"
}
```

### Store Fingerprinting

The scraper identifies the store platform from HTML signals and domain patterns. If a known platform (Shopify, WooCommerce, BigCommerce) is detected, the scraper skips and redirects to the appropriate API connector instead.

### Known Limitations

- Only works on publicly accessible pages — no login-protected pages
- Anti-scraping measures (e.g. Cloudflare, CAPTCHA) will block extraction — Ajio returns 403
- Incremental sync is not supported — always runs a full scrape
- AI selector generation uses Gemini API quota — 429 errors handled with fallback
- JavaScript-heavy sites require Playwright rendering which is slower than static HTML parsing
- Variant detection is best-effort — complex variant selectors may not extract correctly
- Scraped data quality is lower than API data — missing brand and category is common

---

## 7. Adding a New Store

### Adding a New Shopify or WooCommerce Store

**Step 1 — Add credentials to `.env`**

For Shopify:
```env
SHOPIFY_STORE_URL_2=https://second-store.myshopify.com
SHOPIFY_ACCESS_TOKEN_2=shpat_xxxxxxxxxxxxxxxxxxxx
```

**Step 2 — Register the store in MongoDB**

```javascript
db.stores.insertOne({
  storeId: "store_shopify_002",
  name: "My Second Shopify Store",
  domain: "second-store.myshopify.com",
  platform: "shopify",
  lastSyncedAt: null,
  lastSyncStatus: null,
  createdAt: new Date()
})
```

**Step 3 — Add to scheduler**

```bash
curl -X POST http://localhost:3000/scheduler/add \
  -H "Content-Type: application/json" \
  -d '{
    "storeId": "store_shopify_002",
    "platform": "shopify",
    "cronExpression": "0 */6 * * *"
  }'
```

**Step 4 — Trigger first full sync**

```bash
curl -X POST http://localhost:3000/scheduler/sync/store_shopify_002 \
  -H "Content-Type: application/json" \
  -d '{ "force": true }'
```

---

### Adding a New Scraped Site

**Step 1 — Test the scraper on the URL first**

```javascript
const { scrapeStore } = require('./services/scraper/scraper.orchestrator');
const products = await scrapeStore('https://new-site.com');
console.log(products.length, 'products found');
```

**Step 2 — Register the store in MongoDB**

```javascript
db.stores.insertOne({
  storeId: "store_scraped_newsite",
  name: "New Site",
  domain: "new-site.com",
  platform: "scraped",
  lastSyncedAt: null,
  lastSyncStatus: null,
  createdAt: new Date()
})
```

**Step 3 — Add to scheduler (scraped sites run daily)**

```bash
curl -X POST http://localhost:3000/scheduler/add \
  -H "Content-Type: application/json" \
  -d '{
    "storeId": "store_scraped_newsite",
    "platform": "scraped",
    "cronExpression": "0 2 * * *"
  }'
```

Note: Scraped sites always run full syncs — incremental sync is not supported.

---

### Adding a New Magento, BigCommerce or Unicommerce Store

Follow the same pattern as above:
1. Add credentials to `.env`
2. Insert store document into MongoDB
3. Trigger manual full sync via the platform-specific sync endpoint

These platforms do not currently support scheduler-based auto-sync. Use their dedicated endpoints:

| Platform | Full sync endpoint |
|---|---|
| Magento | `POST /sync/magento` |
| BigCommerce | `POST /sync/bigcommerce` |
| Unicommerce | `POST /sync/unicommerce` |

---

## Default Sync Frequencies

| Platform | Default Cron | Frequency |
|---|---|---|
| Shopify | `0 */6 * * *` | Every 6 hours |
| WooCommerce | `0 */6 * * *` | Every 6 hours |
| Magento | `0 */8 * * *` | Every 8 hours |
| BigCommerce | `0 */6 * * *` | Every 6 hours |
| Unicommerce | `0 */12 * * *` | Every 12 hours |
| Scraped sites | `0 2 * * *` | Daily at 2am |

---

## Environment Variables Reference

```env
# Shopify
SHOPIFY_STORE_URL=
SHOPIFY_ACCESS_TOKEN=
SHOPIFY_WEBHOOK_SECRET=

# Magento
MAGENTO_STORE_URL=
MAGENTO_ACCESS_TOKEN=

# WooCommerce
WOOCOMMERCE_STORE_URL=
WOOCOMMERCE_CONSUMER_KEY=
WOOCOMMERCE_CONSUMER_SECRET=

# BigCommerce
BIGCOMMERCE_STORE_HASH=
BIGCOMMERCE_CLIENT_ID=
BIGCOMMERCE_ACCESS_TOKEN=

# Unicommerce
UNICOMMERCE_BASE_URL=
UNICOMMERCE_USERNAME=
UNICOMMERCE_PASSWORD=
UNICOMMERCE_CLIENT_ID=

# Scraper
GEMINI_API_KEY=

# Database
MONGODB_URI=mongodb://localhost:27017/ingestion-engine

# Server
PORT=3000

# API Auth
INTERNAL_API_KEY=uniquekey
```