# Schema Documentation — Commerce Integration & Data Ingestion Engine

**Version:** 1.0.0

This document describes the data schemas for the three core collections exposed via the API: canonical products, offers, and stores.

For platform-specific transformation rules and edge cases, see the internal schema validation document (`Schema Documentation v1.2.0`).

---

## 1. Canonical Product

The canonical product is the unified, deduplicated master record for a product aggregated across all platforms. Stored in the `canonical_products` collection.

### Schema

| Field | Type | Nullable | Description |
|---|---|---|---|
| `canonicalId` | string | No | Unique product identifier. Always prefixed with `cprod_`. e.g. `cprod_259dfdc638a7de3b6de2e7ae` |
| `title` | string | No | Product name as ingested from source |
| `cleanedTitle` | string | Yes | Title with trademark symbols (`®™©`) stripped |
| `brand` | string | Yes | Brand name. `null` if not available from source |
| `normalizedBrand` | string | Yes | Brand lowercased and trimmed. `null` if brand is null |
| `category` | string | Yes | Product category. `null` if not available |
| `description` | string | Yes | Product description with HTML stripped. `null` if not available |
| `images` | array | No | Array of image objects. Empty array `[]` if no images — never `null` |
| `variants` | array | No | Array of variant objects. Always has at least one entry — simple products get a synthetic variant |
| `attributes` | object | No | Key-value pairs of extra product attributes (e.g. `{ "color": "Blue", "size": "M" }`). Empty object `{}` if none |
| `tags` | array | No | Array of tag strings. Empty array `[]` if none |
| `priceRange` | object | Yes | Price range across all variants. `null` if no pricing available |
| `priceRange.min` | number | Yes | Lowest variant price |
| `priceRange.max` | number | Yes | Highest variant price |
| `priceRange.currency` | string | Yes | ISO 4217 currency code e.g. `"INR"`, `"USD"` |
| `price_history` | number | Yes | Previous price value — used for anomaly detection |
| `sourceCount` | number | No | Number of source platform records linked to this product |
| `sources` | array | No | Array of platform strings this product was ingested from e.g. `["shopify", "scraped"]` |
| `status` | string | Yes | Product status. One of: `active`, `inactive`, `draft`, `archived` |
| `createdAt` | date | No | When the canonical record was first created |
| `updatedAt` | date | No | When the canonical record was last updated |

### Image Object

| Field | Type | Nullable | Description |
|---|---|---|---|
| `url` | string | No | Full HTTP URL of the image |
| `altText` | string | Yes | Alt text for the image |
| `position` | number | No | Display order (0-indexed) |

### Variant Object

| Field | Type | Nullable | Description |
|---|---|---|---|
| `variantId` | string | No | Platform-specific variant identifier |
| `sku` | string | Yes | Stock keeping unit. `null` if not provided by source |
| `price` | number | Yes | Variant price as a number. `null` if unavailable |
| `compareAtPrice` | number | Yes | Original price before discount. `null` if no discount |
| `currency` | string | Yes | ISO 4217 currency code |
| `inventoryQty` | number | Yes | Available stock quantity. `null` if unmanaged |
| `isInStock` | boolean | No | Whether the variant is available to purchase |
| `availability` | string | No | One of: `in_stock`, `limited`, `out_of_stock` |

### Notes

- `canonicalId` is a SHA-256 hash of `normalizedTitle + normalizedBrand` prefixed with `cprod_`
- All prices are stored as numbers — never strings
- Empty strings from source platforms are converted to `null`
- Arrays (`images`, `variants`, `tags`) are never `null` — always empty array at minimum

---

## 2. Offer

An offer represents the price and availability of a canonical product at a specific store. One canonical product can have many offers across different stores. Stored in the `offers` collection.

### Schema

| Field | Type | Nullable | Description |
|---|---|---|---|
| `canonicalProductId` | string | No | Links to canonical product's `canonicalId` |
| `storeId` | string | No | Links to store's `storeId` |
| `sourceId` | string | No | Platform-native product ID (e.g. Shopify GID) |
| `variantId` | string | No | Platform-native variant ID |
| `platform` | string | No | Source platform. One of: `shopify`, `magento`, `woocommerce`, `bigcommerce`, `unicommerce`, `scraped`, `generic` |
| `price` | number | Yes | Current selling price |
| `compareAtPrice` | number | Yes | Original price before discount. `null` if no discount |
| `currency` | string | Yes | ISO 4217 currency code |
| `availability` | string | No | One of: `inStock`, `outOfStock`, `limited` |
| `inventoryQty` | number | Yes | Stock quantity. `null` if unmanaged by platform |
| `updatedAt` | date | No | When this offer was last synced |

### Notes

- Offers are sorted by `price` ascending when returned via `GET /offers?product_id=`
- `inStockCount` in the offer summary counts offers where `availability === "inStock"`
- Unicommerce: `inventoryQty = inventory - blockedInventory` (blocked stock excluded)

---

## 3. Store

A store represents a connected platform instance. Stored in the `stores` collection.

### Schema

| Field | Type | Nullable | Description |
|---|---|---|---|
| `storeId` | string | No | Unique store identifier e.g. `store_shopify_001` |
| `name` | string | No | Human-readable store name |
| `domain` | string | Yes | Store domain e.g. `mystore.myshopify.com` |
| `platform` | string | No | One of: `shopify`, `magento`, `woocommerce`, `bigcommerce`, `unicommerce`, `scraped` |
| `lastSyncedAt` | date | Yes | Timestamp of last successful sync. `null` if never synced |
| `lastSyncStatus` | string | Yes | One of: `success`, `partial`, `failed`. `null` if never synced |
| `createdAt` | date | No | When the store was registered |

### Notes

- `lastSyncedAt` is only updated when the entire sync batch succeeds with zero failures
- `lastSyncStatus: "partial"` means some products failed — cursor not advanced, will retry same window
- `productCount` is computed at query time by counting canonical products with matching `sources.storeId`

---

## 4. Data Quality Issue

Flagged data problems detected by the validation layer. Stored in the `data_quality_issues` collection.

### Schema

| Field | Type | Description |
|---|---|---|
| `canonicalProductId` | string | Which product has the issue |
| `issueCode` | string | Machine-readable code e.g. `MISSING_PRICE`, `BRAND_CONFLICT` |
| `issueDescription` | string | Human-readable explanation |
| `severity` | string | `critical` (broken data) or `warning` (incomplete data) |
| `affectedField` | string | Which field has the problem e.g. `priceRange.min` |
| `affectedValue` | any | The actual bad value |
| `resolved` | boolean | Whether the issue has been fixed |
| `detectedAt` | date | When the issue was first found |
| `resolvedAt` | date | When the issue was marked resolved. `null` if still open |

### Issue Codes

| Code | Severity | Description |
|---|---|---|
| `MISSING_PRICE` | critical | Product has no price data |
| `INVALID_PRICE_TYPE` | critical | Price is not a number |
| `INVALID_PRICE_VALUE` | critical | Price is zero or negative |
| `INVALID_PRICE_RANGE` | critical | Min price exceeds max price |
| `MISSING_TITLE` | critical | Product has no title |
| `TITLE_TOO_LONG` | critical | Title exceeds 500 characters |
| `INVALID_TITLE` | critical | Title contains no alphabetic characters |
| `ANOMALOUS_PRICE_CHANGE` | critical | Price changed by more than 50% since last sync |
| `SKU_CONFLICT` | critical | Same SKU mapped to multiple canonical products |
| `MISSING_IMAGES` | warning | Product has no images |
| `INVALID_IMAGE_URL` | warning | Image URL does not start with `http` |
| `INVALID_CURRENCY` | warning | Currency is not a valid 3-letter ISO code |
| `MISSING_BRAND` | warning | Product has no brand |
| `NO_STOCK_AVAILABLE` | warning | Product has pricing but no in-stock offers |
| `NO_OFFERS` | warning | Product has no offers in any store |
| `STALE_PRODUCT` | warning | Product not updated in 30+ days |
| `BRAND_CONFLICT` | warning | Conflicting brands across source platforms |
| `NO_SOURCES` | warning | Canonical product has no source mappings |

---

## 5. Platform Enum Values

These are the valid values for the `platform` field across all collections:

| Value | Description |
|---|---|
| `shopify` | Shopify API connector |
| `magento` | Magento REST connector |
| `woocommerce` | WooCommerce REST connector |
| `bigcommerce` | BigCommerce REST connector |
| `unicommerce` | Unicommerce REST connector |
| `scraped` | Generic website scraper (known store) |
| `generic` | Generic website scraper (unrecognized store) |

## 6. Sync Metric

storeId
platform
syncType
status
totalProducts
successProducts
failedProducts
durationMs
syncedAt
isFullSync
errorMessage

## 7. API Metric

endpoint
hour
requestCount
errorCount
avgResponseTimeMs
totalResponseTimeMs