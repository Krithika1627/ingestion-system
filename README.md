# Commerce Integration And Data Ingestion Engine

A commerce data ingestion engine that fetches product, pricing, inventory, and category data from multiple e-commerce platforms and normalizes it into a unified canonical schema for AI and internal systems to consume.

**Platforms:** Shopify · Magento · WooCommerce · Unicommerce · BigCommerce

---

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express
- **Database:** MongoDB + Mongoose
- **Validation:** AJV + ajv-formats
- **Logging:** Winston
- **HTTP:** Axios

---

## Project Structure

```
bae-ingestion-engine/
│
├── connectors/                  # Platform API clients — fetch + paginate + rate limit
│   ├── shopify.connector.js
│   ├── magento.connector.js
│   ├── woocommerce.connector.js
│   ├── unicommerce.connector.js
│   └── bigcommerce.connector.js
│
├── transformers/                # Field mapping — raw platform JSON → canonical schema
│   ├── shopify.transformer.js
│   ├── magento.transformer.js
│   ├── woocommerce.transformer.js
│   ├── unicommerce.transformer.js
│   └── bigcommerce.transformer.js
│
├── pipelines/                   # Orchestration — connector → transform → validate → store
│   ├── product.pipeline.js
│   ├── category.pipeline.js
│   └── inventory.pipeline.js
│
├── schemas/                     # Canonical JSON schemas (AJV validated)
│   ├── product.schema.json
│   ├── store.schema.json
│   ├── offer.schema.json
│   └── category.schema.json
│
├── services/                    # Shared utilities
│   ├── db.service.js
│   └── logger.service.js
│
├── mock-data/                   # Synthetic platform datasets for development
│   ├── shopify-mock.json
│   ├── magento-mock.json
│   ├── woocommerce-mock.json
│   ├── unicommerce-mock.json
│   ├── bigcommerce-mock.json
│   └── stores-mock.json
│
├── scripts/                     # Utility scripts
│   ├── generate-mock-data.py
│   └── validate-schemas.js
│
├── docs/                        # Architecture and integration docs
│   ├── architecture.md
│   ├── field-mapping.md
│   └── schema-documentation.md
│
├── logs/                        # Winston log output (gitignored)
├── index.js                     # Express entry point
├── .env.example                 # Environment variable template
└── .gitignore
```

---

## Setup

### Prerequisites
- Node.js v18+
- MongoDB running locally or a MongoDB Atlas URI
- API credentials for the platforms you want to connect

### Installation

```bash
# Clone the repo
git clone https://github.com/your-username/bae-ingestion-engine.git
cd bae-ingestion-engine

# Install dependencies
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```env
# Server
PORT=3000
NODE_ENV=development

# MongoDB
MONGO_URI=mongodb://localhost:27017/ingestion-engine

# Shopify
SHOPIFY_ACCESS_TOKEN=
SHOPIFY_STORE_URL=
SHOPIFY_API_VERSION=2026-04

# Magento
MAGENTO_ACCESS_TOKEN=
MAGENTO_STORE_URL=

# WooCommerce
WOOCOMMERCE_CONSUMER_KEY=
WOOCOMMERCE_CONSUMER_SECRET=
WOOCOMMERCE_STORE_URL=

# Unicommerce
UNICOMMERCE_AUTH_TOKEN=
UNICOMMERCE_FACILITY_CODE=
UNICOMMERCE_STORE_URL=

# BigCommerce
BIGCOMMERCE_API_KEY=
BIGCOMMERCE_STORE_HASH=
BIGCOMMERCE_STORE_URL=
```

### Run

```bash
# Development
node index.js

# Health check
GET http://localhost:3000/health
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Server health check |
| POST | `/sync/shopify` | Trigger full Shopify product sync |
| POST | `/sync/shopify/categories` | Sync Shopify collections into categories collection |
| POST | `/sync/magento` | Trigger full Magento product + category sync |
| POST | `/sync/magento/categories` | Sync Magento category tree |
| POST | `/sync/woocommerce` | Trigger full WooCommerce sync |
| POST | `/sync/unicommerce` | Trigger Unicommerce inventory update |
| POST | `/sync/bigcommerce` | Trigger full BigCommerce sync |
| POST | `/stores` | Seed or create a store record |
| GET  | `/stores` | List all connected stores |

**Sync response format:**
```json
{
  "success": true,
  "message": "Sync complete",
  "summary": {
    "total": 17,
    "success": 17,
    "failed": 0,
    "duration": 0.77
  }
}
```

---

## MongoDB Collections

| Collection | Description |
|---|---|
| `products` | Canonical normalized product records |
| `offers` | Price + availability per product per store |
| `categories` | Normalized category/collection records |
| `stores` | Store config and credentials |
| `raw_responses` | Raw platform API responses (for debugging) |

---

## Progress

### ✅ Week 1 — System Design + Foundation

- [x] Define canonical data model (products, stores, offers, categories)
- [x] Collect sample payloads from Shopify, Magento, WooCommerce, Unicommerce, BigCommerce
- [x] Identify and categorize all fields (mandatory, optional, derived, platform-specific)
- [x] Define product schema
- [x] Define store schema
- [x] Define offer schema
- [x] Define category schema
- [x] Normalize field types and define constraints
- [x] Add derived fields (cleanedTitle, normalizedBrand, pricePerUnit)
- [x] Create versioned schema files (`/schemas/*.json`)
- [x] Document schema definitions with examples and edge cases
- [x] Define integration strategy (API, webhook, scraping modes)
- [x] Define sync frequency rules per platform
- [x] Define rate limiting and retry strategy
- [x] Define authentication methods per platform
- [x] Document fallback mechanisms
- [x] Create architecture flow diagram
- [x] Initialize Node.js backend with environment configs
- [x] Create modular folder structure
- [x] Setup linting (ESLint) and formatting (Prettier)
- [x] Configure environment variables
- [x] Setup logging framework (Winston)
- [x] Create base service templates for connectors and pipelines
- [x] Generate synthetic datasets for all 5 platforms (500 products each)
- [x] Create mock store catalogs
- [x] Create field mapping reference document

---

### 🔄 Week 2 — Shopify + Magento Connectors

- [x] Setup Shopify API authentication and token management
- [x] Fetch Shopify products, variants, inventory, pricing via GraphQL
- [x] Implement pagination handling for large catalogs
- [x] Handle Shopify rate limits and retries
- [x] Normalize raw Shopify data using transformer
- [x] Log Shopify API responses and errors
- [x] Validate transformed data against product schema
- [x] Store raw + normalized Shopify data in MongoDB
- [x] Fetch Shopify collections (categories)
- [x] Store canonical category records in MongoDB
- [ ] Setup Magento API authentication (OAuth bearer token)
- [ ] Fetch Magento products via REST API with pagination
- [ ] Extract fields from Magento custom_attributes array
- [ ] Handle Magento simple vs configurable product types
- [ ] Build synthetic variants for Magento simple products
- [ ] Prepend base URL to Magento image paths
- [ ] Fetch Magento categories via /V1/categories endpoint
- [ ] Validate and store Magento canonical records in MongoDB

---

### ⏳ Week 3 — WooCommerce + Unicommerce Connectors

- [ ] Setup WooCommerce consumer key + secret authentication
- [ ] Fetch WooCommerce products with pagination (per_page=100)
- [ ] Strip HTML from WooCommerce descriptions
- [ ] Handle WooCommerce variable products (fetch variations separately)
- [ ] Handle stock_quantity null when manage_stock is false
- [ ] Handle sale_price empty string edge case
- [ ] Fetch WooCommerce categories
- [ ] Setup Unicommerce auth token + facility code
- [ ] Fetch products from Unicommerce /catalog/itemType/get
- [ ] Fetch inventory from Unicommerce /inventorySnapshot/get
- [ ] Merge product + inventory using skuCode as join key
- [ ] Compute availableQty = inventory - blockedInventory
- [ ] Update existing offer records using SKU match (inventory-only)

---

### ⏳ Week 4 — BigCommerce + Scraping Fallback

- [ ] Setup BigCommerce X-Auth-Token authentication
- [ ] Fetch BigCommerce products with variants
- [ ] Resolve brand name from separate /v2/brands/{id} API call
- [ ] Resolve category names from category tree API
- [ ] Build categoryPath array from tree hierarchy
- [ ] Handle BigCommerce date format conversion to ISO 8601
- [ ] Handle inventory_tracking product vs variant level
- [ ] Build generic web scraping fallback layer
- [ ] Extract product data from HTML using CSS selectors
- [ ] Handle scraping failures gracefully

---

### ⏳ Week 5 — Unified Product Graph

- [ ] Design product graph data model
- [ ] Implement cross-platform product deduplication using SKU matching
- [ ] Merge product records from multiple platforms into one canonical entity
- [ ] Link offers from multiple stores to single product record
- [ ] Build category taxonomy mapping across platforms
- [ ] Normalize brand names across platforms using normalizedBrand
- [ ] Handle conflicts when same product has different data across platforms

---

### ⏳ Week 6 — Sync Engine

- [ ] Build automated sync scheduler using cron jobs
- [ ] Implement webhook listener for Shopify real-time updates
- [ ] Implement webhook listener for BigCommerce events
- [ ] Build retry queue for failed sync jobs
- [ ] Implement per-store sync frequency configuration
- [ ] Add sync job status tracking (started, complete, failed)
- [ ] Build sync history log per store
- [ ] Handle partial sync failures without losing good data

---

### ⏳ Week 7 — Internal REST APIs

- [ ] Design API endpoints for AI and frontend teams
- [ ] Build GET /products endpoint with filtering and pagination
- [ ] Build GET /products/:id endpoint
- [ ] Build GET /offers endpoint filtered by productId
- [ ] Build GET /categories endpoint with hierarchy
- [ ] Build GET /stores endpoint
- [ ] Add response caching using Redis
- [ ] Document all endpoints

---

### ⏳ Week 8 — Hardening

- [ ] Add Redis caching layer
- [ ] Add observability (request metrics, sync metrics)
- [ ] Load test sync engine
- [ ] Load test serving APIs
- [ ] Write unit tests for all transformers
- [ ] Write integration tests for all connectors
- [ ] Finalize API documentation
- [ ] Performance optimization pass
- [ ] Final code review and cleanup

---

## Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Shopify API | GraphQL (not REST) | REST is legacy as of Oct 2024, all new apps must use GraphQL from Apr 2025 |
| Ingestion order | Categories → Products → Inventory | Products reference categoryIds — categories must exist first |
| Unicommerce | Inventory-only | Does not provide storefront data — updates existing offer records only |
| Availability threshold | Configurable per store | Business decision — stored in store.syncConfig, never hardcoded |
| Currency | ISO 4217 always | Never store symbols (₹, $) — always store codes (INR, USD) |
| Upsert over insert | Always upsert | Prevents duplicate records on repeated syncs |
| Raw data stored | Yes, separately | Enables replay of transformations without re-fetching from platform |

---

## Docs

| Document | Description |
|---|---|
| `docs/architecture.md` | System architecture, component diagram, Ingestion modes, rate limits, auth methods per platform |
| `docs/field-mapping.md` | Field-by-field mapping from all 5 platforms to canonical schema |
| `docs/schema-documentation.md` | Schema validation, example transformations, edge cases |
