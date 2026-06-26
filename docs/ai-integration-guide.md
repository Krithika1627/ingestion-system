# AI Integration Guide — Commerce Integration & Data Ingestion Engine

**Version:** 1.0.0  
**Audience:** AI/ML teams building on top of the ingestion platform  
**Base URL:** `http://localhost:3000`

---

## Overview

The platform aggregates product data from 6 sources (Shopify, Magento, WooCommerce, BigCommerce, Unicommerce, and generic web scrapers) into a unified canonical product database. AI teams can access this data through dedicated `/ai/*` endpoints that are specifically formatted for LLM consumption — clean, flat, no nulls, and with human-readable context fields pre-built.

---

## Which Endpoints to Use

| Use Case | Endpoint |
|---|---|
| Get a single product for LLM context | `GET /ai/products/:id` |
| Search for products by keyword | `GET /ai/search?q=` |
| Bulk index entire catalog for embeddings | `GET /ai/catalog` |
| Autocomplete / suggestions | `GET /search/suggestions?q=` |

For AI workloads, prefer the /ai/* endpoints. **Do not use** the standard `/products`, `/stores`, `/offers` endpoints for AI pipelines — they may return `null` values and nested structures that require additional handling.

---

## Key Difference: AI Endpoints vs Standard Endpoints

| Property | Standard API (`/products`) | AI API (`/ai/products`) |
|---|---|---|
| Null values | Possible (e.g. `"brand": null`) | Never — replaced with `""` or `0` or `[]` |
| Structure | Nested objects | Flat |
| Price format | `priceRange: { min, max, currency }` | `lowestPrice`, `highestPrice`, `currency` as top-level fields |
| Context strings | None | `summary` and `priceContext` included |
| Availability | Must compute from offers | Pre-computed: `isAvailable`, `inStockStores`, `totalStores` |
| Internal IDs | Exposed (`sourceId`, `storeId`) | Removed — only `id` and human-readable fields |

---

## Endpoint Reference

### `GET /ai/products/:id`

Use this when you need full context about a single product — pricing, availability, where it's sold, and pre-built summary strings.

```bash
curl "http://localhost:3000/ai/products/cprod_6d2e7e8bfde3b44860dff649"
```

**Response:**
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

Use this for keyword-driven product discovery. Returns AI-formatted results plus a `context` field — a plain English paragraph summarizing the search results that an LLM can include directly in a response.

```bash
curl "http://localhost:3000/ai/search?q=hoodie&category=clothing&max_price=2000"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "query": "hoodie",
    "results": [ "...AI formatted products..." ],
    "context": "Found 12 products matching 'hoodie'. Price range: INR 799 to INR 1999. Available on: shopify, scraped."
  },
  "meta": { "page": 1, "total": 12, "hasMore": false }
}
```

The `context` field is designed to be passed directly to an LLM as part of a prompt without any additional processing.

**Supported filters:** `category`, `brand`, `platform`, `min_price`, `max_price`, `availability`  
**Rate limit:** 200 requests per 15 minutes per IP

---

### `GET /ai/catalog`

Use this for bulk indexing — generating embeddings, building vector databases, or training models on the full product catalog. Returns minimal fields per product (no offer joins) for maximum speed.

```bash
curl "http://localhost:3000/ai/catalog?page=1&limit=50"
```

**Response:**
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
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 1049,
    "hasMore": true
  }
}
```

**Recommended approach for full catalog indexing:**

```python
import requests

base_url = "http://localhost:3000"
page = 1
limit = 100
all_products = []

while True:
    response = requests.get(f"{base_url}/ai/catalog?page={page}&limit={limit}")
    data = response.json()
    all_products.extend(data["data"]["items"])
    
    if not data["meta"]["hasMore"]:
        break
    page += 1

print(f"Fetched {len(all_products)} products")
# Now generate embeddings from all_products
```

---

## Field Reference

### Core Identity Fields

| Field | Type | Description | Example |
|---|---|---|---|
| `id` | string | Canonical product ID | `"cprod_259dfdc638a7de3b6de2e7ae"` |
| `name` | string | Product name. Empty string `""` if unavailable | `"Apple iPhone 13"` |
| `brand` | string | Brand name. Empty string `""` if unavailable | `"Apple"` |
| `category` | string | Category. `"Uncategorized"` if unavailable | `"Phones"` |
| `description` | string | Product description with HTML stripped. Empty string `""` if unavailable | `"64GB storage..."` |

### Pricing Fields

| Field | Type | Description | Example |
|---|---|---|---|
| `lowestPrice` | number | Cheapest price across all stores. `0` if no pricing | `55999` |
| `highestPrice` | number | Most expensive price across all stores. `0` if no pricing | `59999` |
| `currency` | string | ISO 4217 currency code | `"INR"` |
| `hasVariablePricing` | boolean | `true` if `lowestPrice !== highestPrice` | `false` |

### Availability Fields

| Field | Type | Description | Example |
|---|---|---|---|
| `isAvailable` | boolean | `true` if at least one store has it in stock | `false` |
| `totalStores` | number | Total stores carrying this product | `1` |
| `inStockStores` | number | Stores with in-stock availability | `0` |

### AI-Specific Context Fields

| Field | Type | Description | Example |
|---|---|---|---|
| `summary` | string | One-line product description. Format: `"{brand} {name} - {category}"`. Never empty | `"Apple iPhone 13 - Phones"` |
| `priceContext` | string | Plain English pricing and availability. Never null | `"Currently out of stock across all stores"` |

### Source Fields

| Field | Type | Description | Example |
|---|---|---|---|
| `platforms` | array | Platforms this product is available on | `["shopify", "scraped"]` |
| `storeCount` | number | Number of stores carrying this product | `1` |
| `lastUpdated` | string | ISO 8601 timestamp of last update | `"2026-05-27T06:29:31.487Z"` |

---

## `priceContext` Values

The `priceContext` field always contains one of these patterns:

| Scenario | Value |
|---|---|
| No offers at all | `"Not available in any store"` |
| All offers out of stock | `"Currently out of stock across all stores"` |
| One store, in stock | `"Available at {storeName} for {currency} {price}"` |
| Multiple stores, in stock | `"Cheapest at {storeName} for {currency} {price}, also available at {store2}, {store3}"` |

This field is designed to be included verbatim in an LLM prompt or response.

---

## `summary` Field

The `summary` field is a single line describing the product:

| Data available | Summary format |
|---|---|
| Brand + Name + Category | `"Apple Apple iPhone 13 - Phones"` |
| Name + Category only (no brand) | `"Apple iPhone 13 - Phones"` |
| Name only | `"Apple iPhone 13"` |

Use `summary` for:
- Embedding generation (more informative than `name` alone)
- Search result snippets
- LLM context when full description is too long

---

## Null Safety Guarantee

All `/ai/*` endpoints guarantee:
- No field in the response will be `null` or `undefined`
- String fields default to `""` (empty string)
- Number fields default to `0`
- Array fields default to `[]` (empty array)
- Boolean fields are always `true` or `false`

This means you can safely do in your code:
```python
# Safe — will never throw AttributeError or KeyError
brand = product["brand"]           # "" not None
price = product["lowestPrice"]     # 0 not None
platforms = product["platforms"]   # [] not None
available = product["isAvailable"] # always bool
```

---

## Example Use Cases

### Use Case 1 — Product Q&A Chatbot

User asks: *"Is the iPhone 13 available and how much does it cost?"*

```python
# 1. Search for the product
results = requests.get("http://localhost:3000/ai/search?q=iPhone 13").json()

# 2. Take the top result
product = results["data"]["results"][0]

# 3. Use priceContext directly in your LLM prompt
prompt = f"""
Answer the user's question about this product.

Product: {product["summary"]}
Availability and pricing: {product["priceContext"]}

User question: Is the iPhone 13 available and how much does it cost?
"""
```

The `priceContext` field gives the LLM exactly what it needs without any additional computation.

---

### Use Case 2 — Catalog Embedding for Semantic Search

```python
import requests

# Fetch full catalog
products = []
page = 1
while True:
    r = requests.get(f"http://localhost:3000/ai/catalog?page={page}&limit=100").json()
    products.extend(r["data"]["items"])
    if not r["meta"]["hasMore"]:
        break
    page += 1

# Generate embeddings using summary field
texts_to_embed = [p["summary"] for p in products]
ids = [p["id"] for p in products]

# embed texts_to_embed with your embedding model
# store in vector DB with ids as keys
```

Use `summary` not `name` for embedding — it includes brand and category which improves retrieval quality.

---

### Use Case 3 — Price Comparison Response

User asks: *"Where is this hoodie cheapest?"*

```python
product = requests.get(
    "http://localhost:3000/ai/products/cprod_6d2e7e8bfde3b44860dff649"
).json()["data"]

# priceContext already has the answer
answer = product["priceContext"]
# "Currently out of stock across all stores"
# OR
# "Cheapest at Mamaearth for INR 799, also available at Bewakoof, Nykaa"
```

---

### Use Case 4 — Category Browse with Context

```python
results = requests.get(
    "http://localhost:3000/ai/search?q=moisturizer&category=skincare&sort=price_asc"
).json()

# context paragraph summarizes the entire result set
context = results["data"]["context"]
# "Found 23 products matching 'moisturizer'. Price range: INR 99 to INR 999. Available on: shopify, scraped."

# Pass context to LLM
prompt = f"Summarize the skincare moisturizer options available: {context}"
```

---

## Validation Warnings

The `/ai/*` endpoints run internal schema validation before returning responses. If a product has data quality issues (e.g. price is null in the database), a `WARN` log is emitted server-side but the response is still returned with safe defaults applied.

This means the response is always safe to consume — but you may want to check `isAvailable`, `lowestPrice === 0`, or `brand === ""` to identify products with incomplete data.

---

## Pagination

All list endpoints (`/ai/catalog`, `/ai/search`) are paginated. Always check `meta.hasMore` before assuming you have all results.

```python
# Always paginate — never assume one page is enough
has_more = True
page = 1
while has_more:
    r = requests.get(f"http://localhost:3000/ai/catalog?page={page}&limit=100").json()
    process(r["data"]["items"])
    has_more = r["meta"]["hasMore"]
    page += 1
```

---

## Rate Limits

| Endpoint | Limit |
|---|---|
| `GET /ai/search` | 100 requests / 15 minutes / IP |
| `GET /ai/catalog` | No rate limit (paginate responsibly) |
| `GET /ai/products/:id` | No rate limit |

---

## Data Freshness

| Platform | Sync frequency | Real-time updates |
|---|---|---|
| Shopify | Every 6 hours | Yes (webhooks) |
| Scraped sites | Daily at 2am | No |
| Magento, BigCommerce, WooCommerce, Unicommerce | Every 6-12 hours | Partial (WooCommerce webhooks) |

`lastUpdated` on each product tells you when the data was last synced. For time-sensitive use cases (e.g. live price checks), cross-reference with `lastUpdated` before using pricing data.