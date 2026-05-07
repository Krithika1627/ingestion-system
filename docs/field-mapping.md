# Field Mapping Reference — v1.0
> Platforms: Shopify (GraphQL) · Magento (REST) · WooCommerce (REST) · Unicommerce (REST) · BigCommerce (REST)
> ⚠️ = gotcha · ✅ = direct map · 🔴 = not available · 🔧 = requires transformation

---

## 1. PRODUCT SCHEMA

### 1.1 Core Fields

| Canonical Field | Category | Shopify | Magento | WooCommerce | Unicommerce | BigCommerce |
|---|---|---|---|---|---|---|
| `id` | mandatory | generated | generated | generated | generated | generated |
| `sourceId` | mandatory | `node.id` ⚠️ GID format | `item.id` → string | `product.id` → string | `itemTypeDTO.skuCode` | `product.id` → string |
| `source` | mandatory | `"shopify"` | `"magento"` | `"woocommerce"` | `"unicommerce"` | `"bigcommerce"` |
| `storeId` | mandatory | passed in | passed in | passed in | passed in | passed in |
| `sku` | optional | `variants.edges[0].node.sku` | `item.sku` | `product.sku` ⚠️ empty string → null | `itemTypeDTO.skuCode` | `product.sku` |
| `title` | mandatory | `node.title` | `item.name` ⚠️ | `product.name` ⚠️ | `itemTypeDTO.name` | `product.name` ⚠️ |
| `description` | optional | `node.description` | `custom_attributes[attribute_code==="description"].value` ⚠️ | strip HTML from `product.description` ⚠️ | `itemTypeDTO.description` | strip HTML from `product.description` ⚠️ |
| `brand` | optional | `node.vendor` | `custom_attributes[attribute_code==="brand"].value` ⚠️ | `meta_data[key==="brand"].value` ⚠️ plugin-dependent | `itemTypeDTO.brand` ✅ | `GET /v2/brands/{brand_id}` → `brand.name` 🔧 |
| `category` | optional | `node.productType` ⚠️ despite the name, this is a category label | `custom_attributes[attribute_code==="category"].value` | `product.categories[0].name` | `itemTypeDTO.categoryCode` | resolve from tree API using `product.categories[0]` 🔧 |
| `categoryPath` | platform-specific | 🔴 | 🔴 | 🔴 | 🔴 | resolve full path array from category tree API 🔧 |
| `productType` | platform-specific | `"unknown"` — Shopify has no product type | `item.type_id` → simple/configurable/bundle | `product.type` → simple/variable/grouped | `"unknown"` | `product.type` → physical/digital |
| `categoryIds` | optional | resolve from collections query 🔧 | `extension_attributes.category_links[].category_id` → lookup canonical IDs 🔧 | `product.categories[].id` → lookup canonical IDs 🔧 | `itemTypeDTO.categoryCode` → lookup canonical ID 🔧 | `product.categories[]` → lookup canonical IDs 🔧 |
| `tags` | optional | `node.tags` ✅ array of strings | 🔴 → `[]` | `product.tags[].name` ⚠️ extract `.name` from objects | `itemTypeDTO.tags` if available | `product.search_keywords` → split by comma |
| `status` | mandatory | `ACTIVE`→active `DRAFT`→draft `ARCHIVED`→archived | `1`→active `2`→inactive ⚠️ number not string | `publish`→active `draft`→draft `private`→inactive `trash`→archived | `enabled: true`→active `false`→inactive | `is_visible: true`→active `false`→inactive |
| `weight` | optional | per-variant only, not product level | `item.weight` | `parseFloat(product.weight)` ⚠️ string | `itemTypeDTO.weight` if available | `product.weight` |
| `createdAt` | optional | `node.createdAt` | `item.created_at` ⚠️ | `product.date_created` ⚠️ | 🔴 | `product.date_created` → convert to ISO 8601 |
| `updatedAt` | optional | `node.updatedAt` | `item.updated_at` ⚠️ | `product.date_modified` ⚠️ | 🔴 | `product.date_modified` → convert to ISO 8601 |
| `lastSyncedAt` | mandatory | `new Date().toISOString()` | `new Date().toISOString()` | `new Date().toISOString()` | `new Date().toISOString()` | `new Date().toISOString()` |

### 1.2 Attributes Mapping

| Platform | Source Field | Extraction Logic | Skip These Keys |
|---|---|---|---|
| Shopify | `node.options[]` | `name.toLowerCase()` → key, `values.join(', ')` → value | — |
| Magento | `item.custom_attributes[]` | `attribute_code` → key, `.value` → value | `description, brand, url_key, category, image, small_image, thumbnail` |
| WooCommerce | `product.attributes[]` | `attribute.name.toLowerCase()` → key, `attribute.options.join(', ')` → value | — |
| Unicommerce | `itemTypeDTO` fields + `customFieldValues[]` | `color` → `attributes.color`, `size` → `attributes.size`, remaining `customFieldValues` → key/value | `name, description, brand, categoryCode, skuCode` |
| BigCommerce | `variant.option_values[]` across all variants | `option_display_name` → key, collect all `label` values across variants → array | — |

**Target format:**
```json
{ "color": "Black", "size": "8", "material": "Mesh" }
```

### 1.3 Images Mapping

| Canonical Field | Shopify | Magento | WooCommerce | Unicommerce | BigCommerce |
|---|---|---|---|---|---|
| `images[].url` | `node.media.edges[].node.preview.image.url` | `storeBaseUrl + "/pub/media/catalog/product" + entry.file` ⚠️ prepend base URL | `product.images[].src` | `itemTypeDTO.imageUrl` → wrap in array | `product.primary_image.url_standard` + `variant.image_url` per variant |
| `images[].altText` | 🔴 null | `entry.label` — null if empty | `image.alt` — null if empty string | 🔴 null | `image.description` |
| `images[].position` | index in array | `entry.position` | index in array | `0` | `image.sort_order` |

**Image safety rules (all platforms):**
```
1. images null/missing          → set images: []
2. url null or empty string     → skip that entry
3. Magento disabled: true       → skip that entry
4. Magento file path            → if already starts with "http" use as-is, else prepend base URL
5. Multiple images              → map all, not just first
```

### 1.4 Variants Mapping

| Canonical Field | Shopify | Magento | WooCommerce | Unicommerce | BigCommerce |
|---|---|---|---|---|---|
| `variantId` | `variant.id` | `item.sku` (simple has no variant) | `variation.id` | `itemTypeDTO.skuCode` | `variant.id` |
| `title` | `variant.title` | 🔴 use sku | 🔴 construct from option values | 🔴 use skuCode | `variant.option_values[].label` joined |
| `sku` | `variant.sku` | `item.sku` | `variation.sku` | `itemTypeDTO.skuCode` | `variant.sku` |
| `price` | `parseFloat(variant.price)` ⚠️ string | `item.price` | `parseFloat(product.price)` ⚠️ string | `itemTypeDTO.basePrice` | `variant.price` |
| `compareAtPrice` | `parseFloat(variant.compareAtPrice)` null if none | from `/V1/products/special-price` endpoint | `parseFloat(product.regular_price)` only if `on_sale===true` | `itemTypeDTO.maxRetailPrice` (MRP) | `variant.retail_price` null if same as price |
| `currency` | `priceRangeV2.minVariantPrice.currencyCode` | store `metaData.currency` fallback | store `metaData.currency` fallback | `itemTypeDTO.itemPrice.currency` | store `metaData.currency` fallback |
| `inventoryQty` | `variant.inventoryQuantity` | `extension_attributes.stock_item.qty` | `product.stock_quantity` null if `manage_stock===false` | `inventory - blockedInventory` ⚠️ must subtract blocked | `variant.inventory_level` |
| `isInStock` | `inventoryQuantity > 0` | `stock_item.is_in_stock` | `stock_status === "instock"` | `(inventory - blockedInventory) > 0` | `variant.inventory_level > 0` |

**Synthetic variant rule (Magento simple + WooCommerce simple):**
```
Build one variant object from the base product fields.
variantId = item.sku (Magento) or product.id as string (WooCommerce)
price     = item.price / parseFloat(product.price)
```

---

## 2. OFFER SCHEMA

| Canonical Field | Category | Shopify | Magento | WooCommerce | Unicommerce | BigCommerce |
|---|---|---|---|---|---|---|
| `id` | mandatory | generated | generated | generated | generated | generated |
| `productId` | mandatory | lookup by sourceId post-ingestion | lookup by sourceId post-ingestion | lookup by sourceId post-ingestion | lookup by skuCode match | lookup by sourceId post-ingestion |
| `storeId` | mandatory | passed in | passed in | passed in | passed in | passed in |
| `variantId` | optional | `variant.id` | `item.sku` | `variation.id` | `itemTypeDTO.skuCode` | `variant.id` |
| `sku` | optional | `variant.sku` | `item.sku` | `product.sku` or `variation.sku` | `itemTypeDTO.skuCode` | `variant.sku` |
| `price` | mandatory | `parseFloat(variant.price)` | `item.price` | `parseFloat(product.price)` ⚠️ check `on_sale` first | `itemTypeDTO.basePrice` | `variant.price` |
| `originalPrice` | optional | `parseFloat(variant.compareAtPrice)` null if none | `/V1/products/special-price` endpoint | `parseFloat(product.regular_price)` only if `on_sale===true` | `itemTypeDTO.maxRetailPrice` | `variant.retail_price` null if equal to price |
| `discountPercent` | derived | `Math.round(((orig-price)/orig)*100)` | same formula | same formula | same formula | same formula |
| `currency` | mandatory | `priceRangeV2.minVariantPrice.currencyCode` | store `metaData.currency` ⚠️ not in response | store `metaData.currency` ⚠️ not in response | `itemTypeDTO.itemPrice.currency` | store `metaData.currency` ⚠️ not in response |
| `availability` | mandatory | threshold logic ⚠️ | threshold logic ⚠️ | `instock`→in_stock `outofstock`→out_of_stock `onbackorder`→limited ✅ | threshold logic on `(inventory-blockedInventory)` ⚠️ | threshold logic ⚠️ |
| `stockQty` | optional | `variant.inventoryQuantity` | `stock_item.qty` | `product.stock_quantity` null if `manage_stock===false` | `inventory - blockedInventory` ⚠️ | `variant.inventory_level` |
| `blockedQty` | platform-specific | 🔴 | 🔴 | 🔴 | `inventorySnapshot.blockedInventory` | 🔴 |
| `minimumSellingPrice` | platform-specific | 🔴 | 🔴 | 🔴 | `itemTypeDTO.itemPrice.msp` | 🔴 |
| `productUrl` | optional | `"https://"+domain+"/products/"+node.handle` | `"https://"+domain+"/"+url_key+".html"` | `product.permalink` ✅ | `itemTypeDTO.productPageUrl` ✅ | `"https://"+domain+product.custom_url.url` |
| `lastSyncedAt` | mandatory | `new Date().toISOString()` | `new Date().toISOString()` | `new Date().toISOString()` | `new Date().toISOString()` | `new Date().toISOString()` |

**Availability threshold logic (Shopify, Magento, Unicommerce, BigCommerce):**
```
stockQty === 0                              → "out_of_stock"
stockQty > 0 && <= availabilityThreshold   → "limited"
stockQty > availabilityThreshold           → "in_stock"
stockQty === null                          → use is_in_stock boolean or stock_status string

availabilityThreshold = store.syncConfig.availabilityThreshold (default: 10)
⚠️ Never hardcode. Must be configurable per store.
```

**discountPercent formula:**
```javascript
discountPercent = (originalPrice && originalPrice > price)
  ? Math.round(((originalPrice - price) / originalPrice) * 100)
  : null
```

---

## 3. STORE SCHEMA

| Canonical Field | Category | Source | Notes |
|---|---|---|---|
| `id` | mandatory | generated | — |
| `name` | mandatory | manual onboarding | — |
| `platform` | mandatory | manual onboarding | enum: shopify, magento, woocommerce, unicommerce, bigcommerce, generic |
| `domain` | mandatory | manual onboarding | Shopify: `.myshopify.com`. Unicommerce: tenant subdomain. BigCommerce: `store-{hash}.mybigcommerce.com` |
| `isActive` | mandatory | manual | `false` = paused, not deleted |
| `syncFrequency` | optional | manual | shopify→realtime, magento/woocommerce/unicommerce/bigcommerce→hourly, generic→daily |
| `ingestionType` | optional | manual | `full` for all except unicommerce which is `inventory-only` |
| `credentials.accessToken` | mandatory | merchant-provided | Shopify + Magento |
| `credentials.apiKey` | mandatory | merchant-provided | Shopify + BigCommerce |
| `credentials.apiSecret` | mandatory | merchant-provided | Shopify + BigCommerce |
| `credentials.consumerKey` | mandatory | merchant-provided | WooCommerce only |
| `credentials.consumerSecret` | mandatory | merchant-provided | WooCommerce only |
| `credentials.facilityCode` | mandatory | merchant-provided | Unicommerce only |
| `credentials.authToken` | mandatory | merchant-provided | Unicommerce only |
| `credentials.storeHash` | mandatory | merchant-provided | BigCommerce only — from control panel URL |
| `metaData.currency` | optional | manual | ISO 4217. Fallback for Magento/WooCommerce/BigCommerce which don't return currency in product response |
| `syncConfig.availabilityThreshold` | optional | manual | default 10. Must be configurable — never hardcoded |
| `syncConfig.batchSize` | optional | manual | Shopify max 250, Magento/WooCommerce default 10, BigCommerce max 250 |
| `syncConfig.rateLimitDelay` | optional | manual | ms between API calls. Default 500ms |
| `createdAt` | mandatory | system | set at onboarding |
| `lastSyncedAt` | optional | system | updated after each successful sync |

---

## 4. CATEGORY SCHEMA

| Canonical Field | Category | Shopify | Magento | WooCommerce | Unicommerce | BigCommerce |
|---|---|---|---|---|---|---|
| `id` | mandatory | generated | generated | generated | 🔴 no category API | generated |
| `sourceId` | mandatory | `collection.id` GID format | `category.id` → string | `category.id` → string | 🔴 | `category.id` → string |
| `source` | mandatory | `"shopify"` | `"magento"` | `"woocommerce"` | 🔴 | `"bigcommerce"` |
| `storeId` | mandatory | passed in | passed in | passed in | 🔴 | passed in |
| `name` | mandatory | `collection.title` | `category.name` ✅ | `category.name` ✅ | 🔴 | `category.name` from tree API |
| `slug` | optional | `collection.handle` | `custom_attributes[url_key].value` ⚠️ | `category.slug` ✅ | 🔴 | `category.url` strip slashes |
| `parentId` | optional | null ⚠️ flat | `category.parent_id` → null if `===1` | `category.parent` → null if `===0` | 🔴 | `category.parent_id` → null if `===0` |
| `level` | optional | `0` flat | `category.level` ⚠️ skip 0 and 1 | derived: `parent===0 ? 0 : 1` | 🔴 | derived from tree depth |
| `description` | optional | `collection.description` | `custom_attributes[description].value` ⚠️ | `category.description` strip HTML | 🔴 | `category.description` strip HTML |
| `imageUrl` | optional | `collection.image.url` | 🔴 | `category.image.src` | 🔴 | `category.image_url` |
| `productCount` | optional | `collection.productsCount` | 🔴 | `category.count` | 🔴 | derive by counting products |
| `isActive` | optional | `true` hardcode | `category.is_active` | `true` hardcode | 🔴 | `category.is_visible` |
| `includeInMenu` | platform-specific | null | `category.include_in_menu` | null | 🔴 | null |
| `path` | platform-specific | null | `category.path` e.g. `"1/2/12"` | null | 🔴 | null |
| `children` | optional | `[]` | `category.children.split(',').filter(Boolean)` ⚠️ string not array | derive: find all where `parent === sourceId` | 🔴 | derive from tree |
| `position` | optional | null | `category.position` | `category.menu_order` | 🔴 | `category.sort_order` |
| `availableSortBy` | platform-specific | `[]` | `category.available_sort_by` | `[]` | 🔴 | `[]` |
| `treeId` | platform-specific | null | null | null | 🔴 | `tree.id` from `/v2/catalog/trees` |
| `createdAt` | optional | 🔴 | `category.created_at` | 🔴 | 🔴 | 🔴 |
| `updatedAt` | optional | `collection.updatedAt` | `category.updated_at` | 🔴 | 🔴 | 🔴 |

---

## 5. PLATFORM API REFERENCE

| Platform | API Type | Products Endpoint | Categories Endpoint | Auth Method |
|---|---|---|---|---|
| Shopify | GraphQL | `POST /admin/api/2024-01/graphql.json` query `products` | query `collections` | `X-Shopify-Access-Token` header |
| Magento | REST | `GET /rest/V1/products` | `GET /rest/V1/categories` | `Authorization: Bearer {token}` |
| WooCommerce | REST | `GET /wp-json/wc/v3/products` | `GET /wp-json/wc/v3/products/categories` | `consumer_key` + `consumer_secret` query params |
| Unicommerce | REST | `POST /catalog/itemType/get` | 🔴 no category API | `Authorization: Bearer {authToken}` + `Facility` header |
| BigCommerce | REST | `GET /v2/catalog/products` | `GET /v2/catalog/trees/{id}/categories` | `X-Auth-Token` header |

---

## 6. INGESTION PIPELINE ORDER

```
⚠️ ALWAYS run in this order — products reference category IDs

1. Categories first    → Shopify/Magento/WooCommerce/BigCommerce
2. Products second     → all platforms
3. Inventory update    → Unicommerce (updates existing offer records using SKU as join key)

Unicommerce flow:
  Step 1: POST /catalog/itemType/get       → product + pricing data
  Step 2: POST /inventorySnapshot/get      → stock data
  Step 3: merge using skuCode as join key  → update offer.stockQty and offer.availability
```

---

## 7. GOTCHAS REFERENCE

| # | Field | Platform | Issue | Fix |
|---|---|---|---|---|
| 1 | `title` field name | All | Shopify=`title`, Magento=`name`, WooCommerce=`name` | platform-specific mapping |
| 2 | `category` vs `productType` | Shopify | `node.productType` is a category label not a type | → `category`, not `productType` |
| 3 | `description` location | Magento | buried in `custom_attributes` array | find where `attribute_code==="description"` |
| 4 | `description` HTML | WooCommerce + BigCommerce | wrapped in `<p>` tags | strip HTML before storing |
| 5 | `brand` location | Magento | buried in `custom_attributes` | find where `attribute_code==="brand"` |
| 6 | `brand` availability | WooCommerce | not native, plugin-dependent | check `meta_data` — may be null |
| 7 | `brand` resolution | BigCommerce | `brand_id` only in product response | separate `GET /v2/brands/{id}` call required |
| 8 | `attributes` extraction | Magento | must skip already-mapped custom_attributes | skip: description, brand, url_key, category, image, small_image, thumbnail |
| 9 | Image URL incomplete | Magento | `file` is a relative path | prepend `storeBaseUrl + /pub/media/catalog/product` |
| 10 | Image null/missing | All | can crash transformer | always guard — set `images: []` if none |
| 11 | `status` is a number | Magento | `1`=active, `2`=inactive | convert before storing |
| 12 | `price` is a string | Shopify + WooCommerce | `"2999.00"` not `2999` | always `parseFloat()` |
| 13 | `sale_price` empty string | WooCommerce | `""` when not on sale | check `on_sale===true` before using `sale_price` |
| 14 | `stock_quantity` null | WooCommerce | null when `manage_stock===false` | fall back to `stock_status` string |
| 15 | No variants | Magento simple + WooCommerce simple | no variant array in response | build one synthetic variant from base product fields |
| 16 | `inventoryQty` calculation | Unicommerce | `inventory` includes blocked stock | always use `inventory - blockedInventory` |
| 17 | Unicommerce is inventory-only | Unicommerce | does not create products | only updates existing offer records via SKU match |
| 18 | Category tree multi-step | BigCommerce | separate APIs for brands + categories | brands: `/v2/brands/{id}`, categories: `/v2/catalog/trees/{id}/categories` |
| 19 | Currency not in response | Magento + WooCommerce + BigCommerce | no currency field in product API | use `store.metaData.currency` as fallback |
| 20 | Currency format | All | must be ISO 4217 | never store `₹` or `$` — always `"INR"`, `"USD"` |
| 21 | Availability threshold | All | business decision | store in `syncConfig.availabilityThreshold` — never hardcode |
| 22 | Shopify IDs are GID strings | Shopify | `gid://shopify/Product/1001` | extract number if needed: `.split('/').pop()` |
| 23 | Category children is string | Magento | `"13,14,15"` not array | `.split(',').filter(Boolean)` |
| 24 | Magento system categories | Magento | levels 0 and 1 are internal | skip during ingestion — real categories start at level 2 |
| 25 | Shopify collections are flat | Shopify | no hierarchy | set `parentId: null`, `level: 0` for all |
| 26 | Category slug hidden | Magento | `url_key` inside `custom_attributes` | find where `attribute_code==="url_key"` |
| 27 | Category pipeline order | All | products reference category IDs | ingest categories BEFORE products — hard dependency |
| 28 | WooCommerce tags are objects | WooCommerce | `[{id, name}]` not `["string"]` | extract `.name` from each object |
| 29 | BigCommerce category tree | BigCommerce | multi-tree support per store | fetch tree ID first, then categories per tree |
| 30 | `date_created` format | BigCommerce | not ISO 8601 | convert using `new Date(date_created).toISOString()` |