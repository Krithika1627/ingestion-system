# Integration Strategy — Commerce Ingestion Engine
**Version:** 1.0.0
**Last Updated:** 2024-05-06
**Platforms:** Shopify · Magento · WooCommerce · Unicommerce · BigCommerce

---

## 1. Objective

Design a scalable and resilient ingestion system that:
- Supports multiple integration modes (API, webhook, scraping)
- Handles both real-time and batch data flows
- Adapts to platform-specific constraints and rate limits
- Normalizes all data into a single canonical schema

---

## 2. Ingestion Modes

### 2.1 API-Based Ingestion (Primary)
All platforms support REST or GraphQL APIs. This is the default mode for all full catalog syncs and initial data loads.

- Structured and predictable response format
- Supports pagination and filtering
- Subject to platform-specific rate limits
- Used for: full sync, catalog ingestion, category ingestion

### 2.2 Webhook-Based Ingestion (Event-Driven)
Webhooks push data to your endpoint when a change occurs. Used to supplement API polling for real-time updates.

- No polling required — platform pushes on event
- Lower API quota consumption
- Must expose a public endpoint to receive events
- Used for: price changes, stock updates, product modifications
- Reliability varies significantly across platforms

### 2.3 Scraping Fallback (Last Resort)
Used only when no API is available — for generic or unsupported storefronts.

- Unstructured HTML parsing
- Fragile — breaks on UI changes
- Slower and less reliable
- Not used for any of the 5 supported platforms (reserved for generic sites)

---

## 3. Mode Assignment Per Platform

| Platform | Primary Mode | Real-Time Updates | Notes |
|---|---|---|---|
| Shopify | GraphQL API | Webhooks (strong support) | Webhooks cover product, inventory, price events natively |
| Magento | REST API | Poll-based (no reliable webhooks) | Magento webhooks exist but are limited — use polling |
| WooCommerce | REST API | Webhooks (partial support) | Webhooks available but server-dependent — treat as supplementary |
| Unicommerce | REST API | Poll-based | Inventory-only — no storefront webhooks |
| BigCommerce | REST API | Webhooks (good support) | Product and inventory webhook events available |
| Generic Sites | Scraping | Not applicable | Fallback only — not for supported platforms |

**Priority order:**
```
API (full sync) → Webhook (real-time delta) → Scraping (unsupported sources only)
```

---

## 4. Batch vs Real-Time Ingestion

### 4.1 Batch Processing
Triggered by a scheduled cron job. Fetches the full product + inventory catalog from the platform API.

**Used for:**
- Initial full sync when a store is first connected
- Daily reconciliation to catch any missed webhook events
- Backfill operations after downtime or failures

**Implementation:** Cron job → connector → transformer → canonical store

### 4.2 Real-Time Processing
Triggered by an incoming webhook event. Fetches only the changed record and updates the canonical store.

**Used for:**
- Inventory level changes (most frequent)
- Price updates
- Product status changes (active/inactive)
- New product additions

**Implementation:** Webhook POST → verify signature → fetch updated record → transformer → canonical store

---

## 5. Sync Frequency Rules

Sync frequency is configurable per store via `store.syncConfig`. The values below are defaults.

| Platform | Full Catalog Sync | Inventory Sync | Trigger Method |
|---|---|---|---|
| Shopify | Daily (00:00 UTC) | Realtime via webhook | `products/update`, `inventory_levels/update` webhook events |
| Magento | Every 6 hours | Hourly | Poll-based — no reliable webhook for inventory |
| WooCommerce | Every 6 hours | Hourly | Poll-based — webhook as supplementary if configured |
| Unicommerce | Not applicable (inventory-only) | Hourly | `POST /inventorySnapshot/get` poll |
| BigCommerce | Daily (00:00 UTC) | Every 2 hours | `store/product/updated`, `store/inventory/updated` webhook events |

**Rules:**
- Inventory sync always runs more frequently than catalog sync — stock changes are more time-sensitive than product data changes
- Full sync always runs even if webhooks are active — to catch any missed or failed events
- Sync frequency can be overridden per store via `store.syncConfig.syncFrequency`
- All sync jobs run with a configurable delay between requests (`store.syncConfig.rateLimitDelay`)

---

## 6. Rate Limits — Verified Per Platform

### 6.1 Shopify (GraphQL Admin API)

| Limit Type | Standard Plan | Advanced Plan | Shopify Plus |
|---|---|---|---|
| Bucket size | 1,000 points | 1,000 points | 10,000 points |
| Restore rate | 50 points/second | 100 points/second | 500 points/second |
| Max cost per single query | 1,000 points | 1,000 points | 1,000 points |
| Error on exceed | HTTP 429 | HTTP 429 | HTTP 429 |

**How cost is calculated:**
- Simple scalar field = 0 points
- Single object = 1 point
- Connection (list) = 1 point per requested item
- Mutation = 10 points

**Headers to read:**
```
X-GraphQL-Cost-Include-Fields: true  (add to request for per-field breakdown)
extensions.cost.throttleStatus.currentlyAvailable  (in response body)
extensions.cost.throttleStatus.restoreRate
```

**Strategy:** Request only needed fields. Use `pageSize` of 50 (not 250) to keep query cost low. Check `currentlyAvailable` before each request and pause if below 200 points.

---

### 6.2 Magento (REST API)

Magento does **not** enforce a hard request-per-minute rate limit by default. Rate limiting is configured at the infrastructure level (Nginx/Apache) by the merchant.

| Limit Type | Default Value | Notes |
|---|---|---|
| Max entities per REST request | 20 (synchronous) | Configurable via Admin or env.php |
| Max entities per async request | 5,000 | Configurable |
| Max page size | 300 items | Configurable |
| Default page size | 20 items | Configurable |
| Hard rate limit | None built-in | Set by merchant's server config |
| Error on exceed | HTTP 429 | If server-level limiting is configured |

**Strategy:** Use `pageSize=20` (safe default). Add 1000ms delay between requests to avoid server overload. Do not assume any specific quota — be conservative. If a 429 is received, back off exponentially.

---

### 6.3 WooCommerce (REST API)

WooCommerce's built-in rate limiting applies to the **Store API** (public/storefront endpoints) only. The **REST API** (authenticated, used by connectors) has no built-in rate limiting — limits are set by the WordPress hosting environment.

| Limit Type | Value | Notes |
|---|---|---|
| Store API limit (if enabled) | 25 requests per 10 seconds | Optional, disabled by default |
| Authenticated REST API limit | No built-in limit | Depends on hosting (Nginx/Apache config) |
| Default page size | 10 items | Use `per_page=100` to increase |
| Max page size | 100 items per request | Hard limit in WooCommerce REST API |
| Error on exceed | HTTP 429 | If hosting-level limiting is active |

**Headers to read:**
```
RateLimit-Limit
RateLimit-Remaining
RateLimit-Reset
RateLimit-Retry-After  (only on 429)
```

**Strategy:** Use `per_page=100` for efficiency. Add 500ms delay between requests. Treat any 429 as a signal to back off — the hosting environment may have its own limits even if WooCommerce doesn't.

---

### 6.4 Unicommerce (REST API)

Unicommerce does not publish official rate limit numbers publicly. Limits are tenant-specific and configured by Unicommerce for each account.

| Limit Type | Value | Notes |
|---|---|---|
| Published rate limit | Not publicly documented | Varies per tenant agreement |
| Safe conservative limit | ~60 requests/minute | Based on integration experience |
| Error on exceed | HTTP 429 | Standard response |

**Strategy:** Keep requests to ~1 per second. Always use exponential backoff on 429. Merge product API and inventory API responses using `skuCode` as join key — minimizes total API calls.

---

### 6.5 BigCommerce (REST API)

| Limit Type | Value | Notes |
|---|---|---|
| Requests per hour (REST) | 60,000 per credential | Per REST API credential |
| Requests per hour (Storefront) | 20,000 | Per store |
| Concurrent connections | 20 max | Per credential |
| B2B Edition limit | 150 requests/minute | Separate from core API |
| Error on exceed | HTTP 429 | With Retry-After header |

**Headers to read:**
```
X-Rate-Limit-Time-Window-Ms   — current window duration
X-Rate-Limit-Time-Reset-Ms    — ms until limit resets
X-Rate-Limit-Requests-Quota   — total quota for window
X-Rate-Limit-Requests-Left    — remaining requests
```

**Strategy:** Monitor `X-Rate-Limit-Requests-Left` with every response. Pause when below 500 remaining. Use `limit=250` for product listing endpoints. Note: brand and category data require separate API calls — each one counts against quota.

---

## 7. Authentication Methods

| Platform | Method | Credentials Required | Where Stored |
|---|---|---|---|
| Shopify | Admin API Access Token | `accessToken` | `store.credentials.accessToken` |
| Magento | OAuth 2.0 Bearer Token | `accessToken` | `store.credentials.accessToken` |
| WooCommerce | Consumer Key + Consumer Secret | `consumerKey`, `consumerSecret` | `store.credentials.consumerKey/Secret` |
| Unicommerce | Bearer Token + Facility Code | `authToken`, `facilityCode` | `store.credentials.authToken/facilityCode` |
| BigCommerce | API Token (X-Auth-Token header) | `apiKey`, `storeHash` | `store.credentials.apiKey/storeHash` |

**Security rules:**
- Credentials are encrypted at rest using AES-256 before storing in the database
- Credentials are never logged — strip from all log output
- Credentials are stored per store in `store.credentials` — never globally
- Token expiry: Magento OAuth tokens expire and must be refreshed. All others are long-lived access tokens
- Authentication is handled exclusively at the connector layer — transformers and pipelines never access credentials

---

## 8. Retry and Backoff Strategy

### 8.1 Exponential Backoff Formula
```
waitTime = baseDelay * (2 ^ attemptNumber) + jitter
```

| Attempt | Base Delay | Wait Time (approx) |
|---|---|---|
| 1st retry | 1s | 1–2s |
| 2nd retry | 2s | 2–4s |
| 3rd retry | 4s | 4–8s |
| Failed (max attempts reached) | — | Mark as failed, log, move on |

**Max retry attempts:** 3 (configurable via `store.syncConfig.retryAttempts`)

### 8.2 What to Retry

| HTTP Status | Action |
|---|---|
| 429 Too Many Requests | Retry with backoff. Check `Retry-After` header if present and wait that long |
| 500 Internal Server Error | Retry up to max attempts |
| 502 Bad Gateway | Retry — likely transient |
| 503 Service Unavailable | Retry with longer backoff |
| 401 Unauthorized | Do NOT retry — credentials invalid. Alert and stop |
| 403 Forbidden | Do NOT retry — permissions issue. Alert and stop |
| 404 Not Found | Do NOT retry — resource doesn't exist. Log and skip |

---

## 9. Fallback Mechanisms

### 9.1 API Failure Fallback
```
1. Retry up to retryAttempts (default: 3) with exponential backoff
2. If all retries fail → log error with full context (platform, endpoint, timestamp, storeId)
3. Mark sync job as failed in sync log
4. Serve last successfully synced data — do not clear existing records
5. Trigger alert (log-level ERROR) for monitoring
6. Next scheduled sync will attempt again automatically
```

### 9.2 Missing or Partial Data Fallback
```
- Missing optional field    → set to null, do not reject the record
- Missing required field    → log warning, skip the record, continue with others
- Invalid price (negative)  → log warning, skip the offer record
- Empty images array        → set images: [], do not skip the product
- HTML in text field        → strip HTML, store plain text
- Empty string where null expected → coerce to null
```

### 9.3 Category Pipeline Failure Fallback
```
- If category ingestion fails → do not run product ingestion for that store
- Products reference categoryIds — orphaned references cause data integrity issues
- Mark store sync as failed and retry full sync from categories
```

---

## 10. Architecture Flow

```
┌─────────────────────────────────────────────────────────┐
│                  External Platforms                      │
│  Shopify  │  Magento  │  WooCommerce  │  BigCommerce    │
│                    Unicommerce                           │
└─────────────────────────────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │    API / Webhooks     │
              └───────────┬───────────┘
                          │
┌─────────────────────────▼─────────────────────────────────┐
│                   Connectors Layer                         │
│  /connectors/shopify.connector.js                          │
│  /connectors/magento.connector.js                          │
│  /connectors/woocommerce.connector.js                      │
│  /connectors/unicommerce.connector.js                      │
│  /connectors/bigcommerce.connector.js                      │
│                                                            │
│  Responsibilities: auth, fetch, paginate, rate limit       │
└─────────────────────────┬─────────────────────────────────┘
                          │ raw platform JSON
┌─────────────────────────▼─────────────────────────────────┐
│                  Transformer Layer                         │
│  /transformers/shopify.transformer.js                      │
│  /transformers/magento.transformer.js                      │
│  /transformers/woocommerce.transformer.js                  │
│  /transformers/unicommerce.transformer.js                  │
│  /transformers/bigcommerce.transformer.js                  │
│                                                            │
│  Responsibilities: field mapping, type coercion,           │
│  HTML stripping, derived field computation,                │
│  null handling, canonical schema output                    │
└─────────────────────────┬─────────────────────────────────┘
                          │ canonical JSON
┌─────────────────────────▼─────────────────────────────────┐
│                  Validation Layer                          │
│  Validate against /schemas/*.json using AJV                │
│  Reject invalid records, log with context                  │
└─────────────────────────┬─────────────────────────────────┘
                          │ validated canonical JSON
┌─────────────────────────▼─────────────────────────────────┐
│               Canonical Data Store (MongoDB)               │
│  Collections: products, stores, offers, categories         │
└─────────────────────────┬─────────────────────────────────┘
                          │
┌─────────────────────────▼─────────────────────────────────┐
│                    Serving Layer                           │
│  Internal REST APIs consumed by AI and frontend teams      │
└────────────────────────────────────────────────────────────┘
```

---

## 11. Pipeline Execution Order

```
For each store sync:

  Step 1: Ingest Categories
    → GET /categories endpoint per platform
    → Transform → Validate → Upsert into categories collection
    → MUST complete before Step 2

  Step 2: Ingest Products
    → GET /products endpoint per platform (paginated)
    → Transform → Validate → Upsert into products + offers collections
    → Requires categories to exist for categoryIds resolution

  Step 3: Inventory Update (Unicommerce stores only)
    → POST /inventorySnapshot/get
    → Match by skuCode → Update stockQty + availability in offers collection
    → Runs independently of Steps 1 and 2

Reason for this order:
Products reference canonical categoryIds.
If categories are not yet ingested, categoryIds will be null/unresolved.
```

---

## 12. Key Design Principles

| Principle | Implementation |
|---|---|
| API-first | All platform connections via official APIs |
| Event-driven where possible | Webhook listeners for Shopify and BigCommerce |
| Configurable per store | Rate limits, batch size, sync frequency in `store.syncConfig` |
| Schema-driven normalization | All transformers output against `/schemas/*.json` |
| Defensive data handling | Missing fields → null, invalid fields → skip record, never crash |
| No hardcoded thresholds | Availability threshold, batch size, retry count all configurable |
| Credentials never logged | Strip from all log output at connector level |
| Category-first pipeline | Always ingest categories before products |