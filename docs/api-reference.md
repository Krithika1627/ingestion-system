# API Reference — Commerce Integration & Data Ingestion Engine

**Base URL:** `http://localhost:3000`  
**Version:** 1.0.0  
**Response format:** All endpoints return JSON with the envelope:
```json
{ "success": true, "data": {}, "meta": {} }
```
On error:
```json
{ "success": false, "error": "message", "code": 404 }
```

---

## Table of Contents

1. [Product APIs](#1-product-apis)
2. [Store APIs](#2-store-apis)
3. [Offer APIs](#3-offer-apis)
4. [Search API](#4-search-api)
5. [AI-Ready APIs](#5-ai-ready-apis)
6. [Data Quality APIs](#6-data-quality-apis)
7. [Metrics APIs](#7-metrics-apis)
8. [Other Endpoints (Internal)](#8-other-endpoints-internal)

---

## 1. Product APIs

### `GET /products`

Returns a paginated list of canonical products with optional filters.

**Query Parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| page | integer | 1 | Page number |
| limit | integer | 20 | Results per page (max 100) |
| sort | string | `updated_at` | One of: `price_asc`, `price_desc`, `updated_at`, `relevance` |
| category | string | — | Filter by category (exact match) |
| brand | string | — | Filter by brand (case-insensitive) |
| platform | string | — | One of: `shopify`, `magento`, `woocommerce`, `bigcommerce`, `unicommerce`, `scraped` |
| availability | string | — | One of: `inStock`, `outOfStock` |
| storeId | string | — | Filter by store ID |

**Example Request**
```bash
curl "http://localhost:3000/products?platform=shopify&sort=price_asc&limit=5"
```

**Example Response**
```json
{
  "success": true,
  "data": [
    {
      "canonicalId": "cprod_259dfdc638a7de3b6de2e7ae",
      "title": "Apple iPhone 13",
      "brand": "Apple",
      "category": "Phones",
      "priceRange": { "min": 55999, "max": 55999, "currency": "INR" },
      "sources": ["scraped"],
      "updatedAt": "2026-05-26T05:43:17.026Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 5,
    "total": 1049,
    "hasMore": true
  }
}
```

---

### `GET /products/:id`

Returns a single canonical product by its canonical ID.

**Path Parameters**

| Param | Description |
|---|---|
| id | Canonical product ID — must start with `cprod_` |

**Example Request**
```bash
curl "http://localhost:3000/products/cprod_259dfdc638a7de3b6de2e7ae"
```

**Example Response**
```json
{
  "success": true,
  "data": {
    "canonicalId": "cprod_259dfdc638a7de3b6de2e7ae",
    "title": "Apple iPhone 13",
    "cleanedTitle": "Apple iPhone 13",
    "brand": "Apple",
    "normalizedBrand": "apple",
    "category": "Phones",
    "images": [],
    "variants": [
      {
        "variantId": "scraped_iphone13",
        "sku": null,
        "price": 55999,
        "currency": "INR",
        "isInStock": true
      }
    ],
    "priceRange": { "min": 55999, "max": 55999, "currency": "INR" },
    "sourceCount": 1,
    "sources": ["scraped"],
    "createdAt": "2026-05-26T05:43:17.026Z",
    "updatedAt": "2026-05-26T05:43:17.026Z"
  }
}
```

**Error Responses**

| Code | Reason |
|---|---|
| 400 | ID does not start with `cprod_` |
| 404 | Product not found |

---

### `GET /products/:id/sources`

Returns the raw source records linked to a canonical product — useful for debugging data origin.

**Example Request**
```bash
curl "http://localhost:3000/products/cprod_259dfdc638a7de3b6de2e7ae/sources"
```

**Example Response**
```json
{
  "success": true,
  "data": {
    "canonicalId": "cprod_259dfdc638a7de3b6de2e7ae",
    "sourceCount": 1,
    "sources": [
      {
        "platform": "scraped",
        "storeId": "store_scraped_mamaearth",
        "sourceId": "https://mamaearth.in/product/iphone13",
        "title": "Apple iPhone 13",
        "price": 55999
      }
    ]
  }
}
```

---

## 2. Store APIs

### `GET /stores`

Returns all connected stores with product count.

**Query Parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| page | integer | 1 | Page number |
| limit | integer | 20 | Results per page (max 100) |

**Example Request**
```bash
curl "http://localhost:3000/stores"
```

**Example Response**
```json
{
  "success": true,
  "data": [
    {
      "storeId": "store_shopify_001",
      "name": "My Shopify Store",
      "platform": "shopify",
      "lastSyncedAt": "2026-06-10T09:00:00Z",
      "lastSyncStatus": "success",
      "productCount": 17
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 6, "hasMore": false }
}
```

---

### `GET /stores/:storeId`

Returns a single store by its store ID.

**Example Request**
```bash
curl "http://localhost:3000/stores/store_shopify_001"
```

**Error Responses**

| Code | Reason |
|---|---|
| 404 | Store not found |

---

### `GET /stores/:storeId/catalog`

Returns all canonical products available in a specific store, paginated.

**Query Parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| page | integer | 1 | Page number |
| limit | integer | 20 | Results per page |
| sort | string | `updated_at` | One of: `price_asc`, `price_desc`, `updated_at` |

**Example Request**
```bash
curl "http://localhost:3000/stores/store_shopify_001/catalog?sort=price_asc"
```

**Example Response**
```json
{
  "success": true,
  "data": {
    "storeId": "store_shopify_001",
    "storeName": "My Shopify Store",
    "platform": "shopify",
    "products": [ "...array of canonical products..." ]
  },
  "meta": { "page": 1, "limit": 20, "total": 17, "hasMore": false }
}
```

---

## 3. Offer APIs

### `GET /offers`

Returns offers filtered by product or store. At least one of `product_id` or `store_id` is required.

**Query Parameters**

| Param | Type | Required | Description |
|---|---|---|---|
| product_id | string | one of | Canonical product ID (`cprod_xxx`) — returns all offers for that product sorted cheapest first |
| store_id | string | one of | Store ID — returns all offers from that store |
| page | integer | no | Page number (default 1) |
| limit | integer | no | Results per page (default 50, max 200) |

**Example Request — By Product**
```bash
curl "http://localhost:3000/offers?product_id=cprod_259dfdc638a7de3b6de2e7ae"
```

**Example Response**
```json
{
  "success": true,
  "data": {
    "canonicalId": "cprod_259dfdc638a7de3b6de2e7ae",
    "summary": {
      "totalOffers": 2,
      "lowestPrice": { "price": 55999, "currency": "INR", "storeName": "Mamaearth" },
      "highestPrice": { "price": 59999, "currency": "INR", "storeName": "Bewakoof" },
      "inStockCount": 1
    },
    "offers": [
      {
        "storeId": "store_scraped_mamaearth",
        "storeName": "Mamaearth",
        "platform": "scraped",
        "price": 55999,
        "currency": "INR",
        "availability": "inStock",
        "variantId": "scraped_iphone13",
        "updatedAt": "2026-05-26T05:43:17.026Z"
      }
    ]
  }
}
```

**Example Request — By Store**
```bash
curl "http://localhost:3000/offers?store_id=store_shopify_001&page=1&limit=10"
```

**Error Responses**

| Code | Reason |
|---|---|
| 400 | Neither `product_id` nor `store_id` provided |
| 400 | `product_id` does not start with `cprod_` |

---

## 4. Search API

### `GET /search`

Full-text keyword search across product title, brand, and description with filtering and sorting.

**Query Parameters**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| q | string | ✅ | — | Search keyword |
| category | string | no | — | Filter by category |
| brand | string | no | — | Filter by brand |
| platform | string | no | — | Filter by platform |
| min_price | number | no | — | Minimum price |
| max_price | number | no | — | Maximum price |
| availability | string | no | — | `inStock` or `outOfStock` |
| sort | string | no | `relevance` | One of: `relevance`, `price_asc`, `price_desc`, `updated_at` |
| page | integer | no | 1 | Page number |
| limit | integer | no | 20 | Results per page (max 100) |

**Example Request**
```bash
curl "http://localhost:3000/search?q=iphone&sort=price_asc&limit=5"
```

**Example Response**
```json
{
  "success": true,
  "data": {
    "query": "iphone",
    "results": [
      {
        "canonicalId": "cprod_259dfdc638a7de3b6de2e7ae",
        "title": "Apple iPhone 13",
        "brand": "Apple",
        "category": "Phones",
        "priceRange": { "min": 55999, "max": 55999, "currency": "INR" },
        "score": 8.5
      }
    ]
  },
  "meta": {
    "page": 1,
    "limit": 5,
    "total": 3,
    "hasMore": false,
    "sort": "price_asc"
  }
}
```

**Notes**
- Returns empty array (not 404) when no results found
- `score` field shows relevance — title matches rank higher than description matches
- Rate limited to 100 requests per 15 minutes per IP

---

### `GET /search/suggestions`

Autocomplete endpoint — returns matching product titles and brands as the user types. Uses partial matching (regex), not full-text search.

**Query Parameters**

| Param | Type | Required | Description |
|---|---|---|---|
| q | string | ✅ | Partial search term (min 2 characters) |

**Example Request**
```bash
curl "http://localhost:3000/search/suggestions?q=iph"
```

**Example Response**
```json
{
  "success": true,
  "data": {
    "query": "iph",
    "suggestions": [
      {
        "canonicalId": "cprod_259dfdc638a7de3b6de2e7ae",
        "title": "Apple iPhone 13",
        "brand": "Apple",
        "category": "Phones"
      }
    ]
  }
}
```

---

## 5. AI-Ready APIs

See the [AI Integration Guide](./ai-integration-guide.md) for full details on using these endpoints.

### `GET /ai/products/:id`

Returns a single product formatted for AI/LLM consumption — flat structure, no nulls, human-readable context fields.

**Example Request**
```bash
curl "http://localhost:3000/ai/products/cprod_6d2e7e8bfde3b44860dff649"
```

**Example Response**
```json
{
  "success": true,
  "data": {
    "id": "cprod_6d2e7e8bfde3b44860dff649",
    "name": "Men's Navy Blue & Beige Top Dawg Graphic Printed Oversized Hoodies",
    "brand": "",
    "category": "Uncategorized",
    "description": "",
    "images": [],
    "attributes": {},
    "lowestPrice": 1499,
    "highestPrice": 1499,
    "currency": "INR",
    "hasVariablePricing": false,
    "totalStores": 1,
    "inStockStores": 0,
    "isAvailable": false,
    "priceContext": "Currently out of stock across all stores",
    "summary": "Men's Navy Blue & Beige Top Dawg Graphic Printed Oversized Hoodies",
    "platforms": ["generic"],
    "storeCount": 1,
    "lastUpdated": "2026-05-27T06:29:31.487Z"
  }
}
```

---

### `GET /ai/search?q=`

Search results formatted for AI consumption with an extra plain-English `context` paragraph.

**Query Parameters:** Same as `GET /search`

**Example Request**
```bash
curl "http://localhost:3000/ai/search?q=hoodie"
```

**Example Response**
```json
{
  "success": true,
  "data": {
    "query": "hoodie",
    "results": [ "...AI formatted products..." ],
    "context": "Found 12 products matching 'hoodie'. Price range: INR 799 to INR 2999. Available on: shopify, scraped."
  },
  "meta": { "page": 1, "total": 12, "hasMore": false }
}
```

---

### `GET /ai/catalog`

Full product catalog in minimal format — optimized for bulk indexing and embedding generation. Does not join offers (fast).

**Query Parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| page | integer | 1 | Page number |
| limit | integer | 50 | Results per page (max 200) |

**Example Request**
```bash
curl "http://localhost:3000/ai/catalog?page=1&limit=50"
```

**Example Response**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "cprod_259dfdc638a7de3b6de2e7ae",
        "name": "Apple iPhone 13",
        "brand": "Apple",
        "category": "Phones",
        "summary": "Apple Apple iPhone 13 - Phones",
        "lowestPrice": 55999,
        "currency": "INR",
        "isAvailable": true,
        "platforms": ["scraped"],
        "lastUpdated": "2026-05-26T05:43:17.026Z"
      }
    ],
    "generatedAt": "2026-06-10T09:00:00.000Z"
  },
  "meta": { "page": 1, "limit": 50, "total": 1049, "hasMore": true }
}
```

---

## 6. Data Quality APIs

### `GET /quality/issues`

Returns flagged data quality issues.

**Query Parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| severity | string | — | `warning` or `critical` |
| resolved | boolean | false | Include resolved issues |
| canonicalProductId | string | — | Filter by product |
| page | integer | 1 | Page number |
| limit | integer | 20 | Results per page |

**Example Request**
```bash
curl "http://localhost:3000/quality/issues?severity=critical"
```

### `GET /quality/issues/summary`

Returns a count breakdown of all open issues grouped by type.

```bash
curl "http://localhost:3000/quality/issues/summary"
```

### `POST /quality/validate`

Triggers a full validation run across all products. Returns `202 Accepted` immediately — runs in background.

```bash
curl -X POST http://localhost:3000/quality/validate
```

### `POST /quality/issues/:id/resolve`

Marks a specific issue as resolved.

```bash
curl -X POST http://localhost:3000/quality/issues/6a1532f56e6acb48e5a5d857/resolve
```

---

## 7. Metrics APIs

### `GET /metrics`

Returns full system observability summary — ingestion stats, API performance, store health, system status.

```bash
curl "http://localhost:3000/metrics"
```

### `GET /metrics/health`

Lightweight health check. Returns system status: `healthy`, `degraded`, or `unhealthy`.

```bash
curl "http://localhost:3000/metrics/health"
```

### `GET /metrics/ingestion`

Returns ingestion-only metrics — sync counts, success rates, platform breakdown.

### `GET /metrics/api`

Returns API-only metrics — request counts, error rates, average response times per endpoint.

### `GET /quality/cache-stats`

Returns cache hit/miss counts across short, medium, and long cache instances.

---

## 8. Other Endpoints (Internal)

These endpoints are for internal use — scheduler management, webhook ingestion, and manual sync triggers. Not intended for downstream consumers.

| Endpoint | Description |
|---|---|
| `POST /scheduler/add` | Register a store for scheduled sync |
| `DELETE /scheduler/:storeId` | Remove a store from the scheduler |
| `PUT /scheduler/:storeId` | Update cron expression for a store |
| `GET /scheduler/jobs` | List all active scheduled jobs |
| `POST /scheduler/sync/:storeId` | Trigger immediate sync for a store |
| `GET /scheduler/sync-status/:storeId` | Get sync state for a store |
| `GET /scheduler/failed-jobs` | List all failed sync jobs |
| `POST /scheduler/failed-jobs/:id/retry` | Retry a failed job |
| `PUT /scheduler/failed-jobs/:id/resolve` | Mark a failed job as resolved |
| `POST /webhooks/shopify/:storeId` | Shopify webhook receiver |
| `POST /webhooks/woocommerce/:storeId` | WooCommerce webhook receiver |
| `GET /webhooks/health` | Webhook listener health check |
| `POST /sync/shopify` | Manual Shopify full sync |
| `POST /sync/magento` | Manual Magento full sync |
| `POST /sync/bigcommerce` | Manual BigCommerce full sync |
| `POST /sync/woocommerce` | Manual WooCommerce full sync |
| `POST /sync/unicommerce` | Manual Unicommerce full sync |
