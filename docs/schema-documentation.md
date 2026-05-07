# Schema Documentation — Validation, Transformations & Edge Cases
**Version:** 1.2.0
**Platforms:** Shopify (GraphQL) · Magento (REST) · WooCommerce (REST) · Unicommerce (REST) · BigCommerce (REST)

---

## 1. SCHEMA VALIDATION

### 1.1 Validation Tool
Schemas are validated using **AJV (Another JSON Validator)** with the `ajv-formats` plugin for date-time format support.

```bash
npm install ajv ajv-formats
```

### 1.2 What Is Validated
| Check | Rule |
|---|---|
| Mandatory fields present | `id`, `sourceId`, `source`, `storeId`, `title`, `status`, `variants`, `lastSyncedAt` |
| Type correctness | `price` is number not string, `isInStock` is boolean not string |
| Enum values | `status` is one of: active, inactive, draft, archived |
| String constraints | `title` is 1–500 chars, `currency` is exactly 3 chars |
| Number constraints | `price >= 0`, `discountPercent` is 0–100, `stockQty >= 0` |
| Array rules | `variants` has minItems 1, `tags` has maxItems 50 |
| Format checks | `createdAt`, `updatedAt`, `lastSyncedAt` are valid ISO 8601 date-time |
| Null safety | Optional fields allow null, required fields do not |

### 1.3 Validation Sources
- Shopify GraphQL product response (real API structure)
- Magento REST `/V1/products` response
- WooCommerce REST `/wp-json/wc/v3/products` response
- Unicommerce `/catalog/itemType/get` + `/inventorySnapshot/get` merged
- BigCommerce `/v2/catalog/products` + brands + category tree merged

### 1.4 Validation Script Location
`/scripts/validate-schemas.js`

Note: Raw platform JSON will NOT pass validation — it is in platform format, not canonical format. Validation runs against the transformer output (canonical JSON). Full validation is completed in Week 2 after transformers are built.

---

## 2. EXAMPLE TRANSFORMATIONS

Each example shows: raw platform input → canonical output → key transformation notes.

---

### 2.1 Shopify

#### Happy Path
**Input (GraphQL response):**
```json
{
  "node": {
    "id": "gid://shopify/Product/1001",
    "title": "Nike® Air Max 2024",
    "description": "Lightweight running shoe",
    "vendor": "Nike",
    "productType": "Footwear",
    "status": "ACTIVE",
    "tags": ["running", "sports"],
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-03-20T14:30:00Z",
    "priceRangeV2": {
      "minVariantPrice": { "amount": "2999.00", "currencyCode": "INR" }
    },
    "variants": {
      "edges": [
        {
          "node": {
            "id": "gid://shopify/ProductVariant/2001",
            "sku": "NK-AIR-8-BLK",
            "price": "2999.00",
            "compareAtPrice": "3999.00",
            "inventoryQuantity": 50
          }
        }
      ]
    },
    "media": {
      "edges": [
        { "node": { "preview": { "image": { "url": "https://cdn.shopify.com/shoe.jpg" } } } }
      ]
    }
  }
}
```

**Output (canonical):**
```json
{
  "id": "prod_generated_uuid",
  "sourceId": "gid://shopify/Product/1001",
  "source": "shopify",
  "storeId": "store_shopify_001",
  "sku": "NK-AIR-8-BLK",
  "title": "Nike® Air Max 2024",
  "description": "Lightweight running shoe",
  "brand": "Nike",
  "category": "Footwear",
  "productType": "unknown",
  "tags": ["running", "sports"],
  "status": "active",
  "images": [{ "url": "https://cdn.shopify.com/shoe.jpg", "altText": null, "position": 0 }],
  "variants": [
    {
      "variantId": "gid://shopify/ProductVariant/2001",
      "sku": "NK-AIR-8-BLK",
      "price": 2999.00,
      "compareAtPrice": 3999.00,
      "currency": "INR",
      "inventoryQty": 50,
      "isInStock": true
    }
  ],
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-03-20T14:30:00Z",
  "lastSyncedAt": "2024-04-01T08:00:00Z",
  "cleanedTitle": "Nike Air Max 2024",
  "normalizedBrand": "nike",
  "pricePerUnit": null
}
```

**Key transformations:**
| Field | Rule Applied |
|---|---|
| `sourceId` | Used as-is — GID string kept intact |
| `brand` | `node.vendor` → `brand` |
| `category` | `node.productType` → `category` (NOT productType — despite field name) |
| `productType` | Set to `"unknown"` — Shopify has no product structure type |
| `status` | `"ACTIVE"` → `"active"` (lowercased) |
| `price` | `parseFloat("2999.00")` → `2999` |
| `compareAtPrice` | `parseFloat("3999.00")` → `3999` |
| `cleanedTitle` | `®` symbol stripped → `"Nike Air Max 2024"` |
| `normalizedBrand` | `"Nike".toLowerCase().trim()` → `"nike"` |

---

### 2.2 Magento

#### Happy Path
**Input (REST response):**
```json
{
  "id": 2001,
  "sku": "AD-SHOE-01",
  "name": "Adidas Running Shoes",
  "price": 2500,
  "status": 1,
  "type_id": "simple",
  "created_at": "2024-01-10T09:00:00Z",
  "updated_at": "2024-03-15T12:00:00Z",
  "weight": 0.6,
  "custom_attributes": [
    { "attribute_code": "description", "value": "High performance running shoes" },
    { "attribute_code": "brand", "value": "Adidas" },
    { "attribute_code": "color", "value": "Blue" },
    { "attribute_code": "url_key", "value": "adidas-running-shoes" }
  ],
  "extension_attributes": {
    "category_links": [
      { "category_id": "12", "position": 0 }
    ],
    "stock_item": {
      "qty": 30,
      "is_in_stock": true
    }
  },
  "media_gallery_entries": [
    {
      "id": 1,
      "media_type": "image",
      "label": "Main image",
      "position": 1,
      "disabled": false,
      "file": "/a/d/adidas-shoe.jpg"
    }
  ]
}
```

**Output (canonical):**
```json
{
  "id": "prod_generated_uuid",
  "sourceId": "2001",
  "source": "magento",
  "storeId": "store_magento_001",
  "sku": "AD-SHOE-01",
  "title": "Adidas Running Shoes",
  "description": "High performance running shoes",
  "brand": "Adidas",
  "category": null,
  "productType": "simple",
  "tags": [],
  "status": "active",
  "weight": 0.6,
  "images": [
    {
      "url": "https://magentostore.com/pub/media/catalog/product/a/d/adidas-shoe.jpg",
      "altText": "Main image",
      "position": 1
    }
  ],
  "attributes": { "color": "Blue" },
  "variants": [
    {
      "variantId": "AD-SHOE-01",
      "sku": "AD-SHOE-01",
      "price": 2500,
      "compareAtPrice": null,
      "currency": "INR",
      "inventoryQty": 30,
      "isInStock": true
    }
  ],
  "createdAt": "2024-01-10T09:00:00Z",
  "updatedAt": "2024-03-15T12:00:00Z",
  "lastSyncedAt": "2024-04-01T08:00:00Z",
  "cleanedTitle": "Adidas Running Shoes",
  "normalizedBrand": "adidas"
}
```

**Key transformations:**
| Field | Rule Applied |
|---|---|
| `sourceId` | `item.id` (number) → `"2001"` (string) |
| `title` | `item.name` → `title` (field rename) |
| `description` | Extracted from `custom_attributes` where `attribute_code === "description"` |
| `brand` | Extracted from `custom_attributes` where `attribute_code === "brand"` |
| `status` | `1` → `"active"` (number to string enum) |
| `productType` | `item.type_id` → `"simple"` |
| `image.url` | `"/a/d/adidas-shoe.jpg"` → prepend `storeBaseUrl + /pub/media/catalog/product` |
| `tags` | Not available in Magento → `[]` |
| `attributes` | All `custom_attributes` NOT already mapped → `{ color: "Blue" }`. Skipped: `description`, `brand`, `url_key` |
| `variants` | Simple product → one synthetic variant built from base product `price` and `stock_item` |
| `currency` | Not in response → use `store.metaData.currency` = `"INR"` |

---

### 2.3 WooCommerce

#### Happy Path
**Input (REST response):**
```json
{
  "id": 3001,
  "name": "Puma Sneakers",
  "sku": "PM-SNKR-01",
  "type": "simple",
  "status": "publish",
  "description": "<p>Comfortable <strong>everyday</strong> sneakers</p>",
  "price": "1800",
  "regular_price": "2200",
  "sale_price": "1800",
  "on_sale": true,
  "manage_stock": true,
  "stock_quantity": 5,
  "stock_status": "instock",
  "weight": "0.4",
  "date_created": "2024-02-01T10:00:00Z",
  "date_modified": "2024-03-10T14:00:00Z",
  "categories": [
    { "id": 12, "name": "Footwear", "slug": "footwear" }
  ],
  "tags": [
    { "id": 35, "name": "casual" },
    { "id": 36, "name": "everyday" }
  ],
  "images": [
    { "id": 101, "src": "https://mystore.com/puma.jpg", "alt": "Puma Sneakers" }
  ],
  "attributes": [
    { "name": "Color", "options": ["White", "Black"] }
  ]
}
```

**Output (canonical):**
```json
{
  "id": "prod_generated_uuid",
  "sourceId": "3001",
  "source": "woocommerce",
  "storeId": "store_woo_001",
  "sku": "PM-SNKR-01",
  "title": "Puma Sneakers",
  "description": "Comfortable everyday sneakers",
  "brand": null,
  "category": "Footwear",
  "productType": "simple",
  "tags": ["casual", "everyday"],
  "status": "active",
  "weight": 0.4,
  "images": [{ "url": "https://mystore.com/puma.jpg", "altText": "Puma Sneakers", "position": 0 }],
  "attributes": { "color": "White, Black" },
  "variants": [
    {
      "variantId": "3001",
      "sku": "PM-SNKR-01",
      "price": 1800,
      "compareAtPrice": 2200,
      "currency": "INR",
      "inventoryQty": 5,
      "isInStock": true
    }
  ],
  "createdAt": "2024-02-01T10:00:00Z",
  "updatedAt": "2024-03-10T14:00:00Z",
  "lastSyncedAt": "2024-04-01T08:00:00Z",
  "cleanedTitle": "Puma Sneakers",
  "normalizedBrand": null
}
```

**Key transformations:**
| Field | Rule Applied |
|---|---|
| `title` | `product.name` → `title` |
| `description` | Strip HTML from `<p>Comfortable <strong>everyday</strong> sneakers</p>` → `"Comfortable everyday sneakers"` |
| `brand` | Not in `meta_data` — plugin not installed → `null` |
| `category` | `product.categories[0].name` → `"Footwear"` |
| `status` | `"publish"` → `"active"` |
| `price` | `on_sale === true` → use `sale_price`: `parseFloat("1800")` → `1800` |
| `compareAtPrice` | `on_sale === true` → use `regular_price`: `parseFloat("2200")` → `2200` |
| `weight` | `parseFloat("0.4")` → `0.4` (string to number) |
| `tags` | `product.tags[].name` → extract `.name` from each object → `["casual", "everyday"]` |
| `attributes` | `attribute.name.toLowerCase()` as key → `{ color: "White, Black" }` |
| `variants` | Simple type → synthetic variant from base product |
| `currency` | Not in response → use `store.metaData.currency` = `"INR"` |

---

### 2.4 Unicommerce

#### Happy Path
**Input (product API + inventory API merged on skuCode):**
```json
{
  "productAPI": {
    "skuCode": "AGS-CP-569",
    "name": "Floral Bedsheet",
    "description": "100% cotton floral bedsheet",
    "brand": "Bombay Dyeing",
    "categoryCode": "HOME_FURNISHING",
    "color": "Blue",
    "size": "King",
    "enabled": true,
    "imageUrl": "https://cdn.unicommerce.com/bedsheet.jpg",
    "productPageUrl": "https://store.com/bedsheet",
    "itemPrice": {
      "currency": "INR",
      "listingPrice": 999,
      "maxRetailPrice": 1299,
      "msp": 850
    },
    "customFieldValues": [
      { "fieldName": "material", "value": "Cotton" }
    ]
  },
  "inventoryAPI": {
    "itemTypeSKU": "AGS-CP-569",
    "inventory": 58,
    "blockedInventory": 8,
    "pendency": 3
  }
}
```

**Output (canonical):**
```json
{
  "id": "prod_generated_uuid",
  "sourceId": "AGS-CP-569",
  "source": "unicommerce",
  "storeId": "store_uni_001",
  "sku": "AGS-CP-569",
  "title": "Floral Bedsheet",
  "description": "100% cotton floral bedsheet",
  "brand": "Bombay Dyeing",
  "category": "HOME_FURNISHING",
  "productType": "unknown",
  "tags": [],
  "status": "active",
  "images": [{ "url": "https://cdn.unicommerce.com/bedsheet.jpg", "altText": null, "position": 0 }],
  "attributes": { "color": "Blue", "size": "King", "material": "Cotton" },
  "variants": [
    {
      "variantId": "AGS-CP-569",
      "sku": "AGS-CP-569",
      "price": 999,
      "compareAtPrice": 1299,
      "currency": "INR",
      "inventoryQty": 50,
      "isInStock": true
    }
  ],
  "createdAt": null,
  "updatedAt": null,
  "lastSyncedAt": "2024-04-01T08:00:00Z",
  "cleanedTitle": "Floral Bedsheet",
  "normalizedBrand": "bombay dyeing"
}
```

**Key transformations:**
| Field | Rule Applied |
|---|---|
| `sourceId` | `itemTypeDTO.skuCode` → used as primary identifier |
| `price` | `itemPrice.listingPrice` → `price` |
| `compareAtPrice` | `itemPrice.maxRetailPrice` → `compareAtPrice` |
| `inventoryQty` | `inventory(58) - blockedInventory(8)` = `50` — NEVER use raw `inventory` |
| `isInStock` | `inventoryQty > 0` → `true` |
| `status` | `enabled: true` → `"active"` |
| `attributes` | `color` + `size` from top-level fields + `customFieldValues[]` → merged into `attributes{}` |
| `createdAt` | Not available in Unicommerce → `null` |
| `productType` | Not available → `"unknown"` |

---

### 2.5 BigCommerce

#### Happy Path
**Input (products API + brands API + category tree API merged):**
```json
{
  "productsAPI": {
    "id": 192,
    "name": "Reebok T-Shirt",
    "type": "physical",
    "sku": "RB-TS-01",
    "description": "<p>Premium quality <b>cotton</b> t-shirt</p>",
    "price": 999.00,
    "retail_price": 999.00,
    "is_visible": true,
    "brand_id": 35,
    "categories": [20, 21],
    "weight": 0.2,
    "search_keywords": "cotton,tshirt,casual",
    "custom_url": { "url": "/reebok-tshirt/" },
    "primary_image": {
      "url_standard": "https://cdn.bigcommerce.com/tshirt.jpg",
      "description": "Reebok T-Shirt"
    },
    "date_created": "Mon, 15 Jan 2024 10:00:00 +0000",
    "date_modified": "Thu, 20 Mar 2024 14:30:00 +0000",
    "variants": [
      {
        "id": 382,
        "sku": "RB-TS-01-BEI",
        "price": 999.00,
        "retail_price": 999.00,
        "inventory_level": 25,
        "option_values": [
          { "option_display_name": "Color", "label": "Beige" },
          { "option_display_name": "Size", "label": "M" }
        ]
      },
      {
        "id": 383,
        "sku": "RB-TS-01-GRY",
        "price": 999.00,
        "retail_price": 999.00,
        "inventory_level": 10,
        "option_values": [
          { "option_display_name": "Color", "label": "Grey" },
          { "option_display_name": "Size", "label": "L" }
        ]
      }
    ]
  },
  "brandsAPI": { "id": 35, "name": "Reebok" },
  "categoryTreeAPI": [
    { "id": 20, "name": "Clothing", "parent_id": 0 },
    { "id": 21, "name": "T-Shirts", "parent_id": 20 }
  ]
}
```

**Output (canonical):**
```json
{
  "id": "prod_generated_uuid",
  "sourceId": "192",
  "source": "bigcommerce",
  "storeId": "store_bc_001",
  "sku": "RB-TS-01",
  "title": "Reebok T-Shirt",
  "description": "Premium quality cotton t-shirt",
  "brand": "Reebok",
  "category": "Clothing",
  "categoryPath": ["Clothing", "T-Shirts"],
  "productType": "physical",
  "tags": ["cotton", "tshirt", "casual"],
  "status": "active",
  "weight": 0.2,
  "images": [{ "url": "https://cdn.bigcommerce.com/tshirt.jpg", "altText": "Reebok T-Shirt", "position": 0 }],
  "attributes": { "Color": ["Beige", "Grey"], "Size": ["M", "L"] },
  "variants": [
    {
      "variantId": "382",
      "sku": "RB-TS-01-BEI",
      "price": 999.00,
      "compareAtPrice": null,
      "currency": "INR",
      "inventoryQty": 25,
      "isInStock": true
    },
    {
      "variantId": "383",
      "sku": "RB-TS-01-GRY",
      "price": 999.00,
      "compareAtPrice": null,
      "currency": "INR",
      "inventoryQty": 10,
      "isInStock": true
    }
  ],
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-03-20T14:30:00Z",
  "lastSyncedAt": "2024-04-01T08:00:00Z",
  "cleanedTitle": "Reebok T-Shirt",
  "normalizedBrand": "reebok"
}
```

**Key transformations:**
| Field | Rule Applied |
|---|---|
| `sourceId` | `product.id` (number) → `"192"` (string) |
| `brand` | `brand_id: 35` → separate `GET /v2/brands/35` → `"Reebok"` (cannot resolve from product alone) |
| `description` | Strip HTML → `"Premium quality cotton t-shirt"` |
| `category` | `categories[0]: 20` → resolve from tree API → `"Clothing"` |
| `categoryPath` | Build from tree: `20 → Clothing (root)`, `21 → T-Shirts (child of 20)` → `["Clothing", "T-Shirts"]` |
| `status` | `is_visible: true` → `"active"` |
| `tags` | `search_keywords: "cotton,tshirt,casual"` → `.split(",")` → `["cotton", "tshirt", "casual"]` |
| `attributes` | Collect all `option_display_name` + `label` across all variants → `{ Color: ["Beige","Grey"], Size: ["M","L"] }` |
| `compareAtPrice` | `retail_price === price` → no discount → `null` |
| `date_created` | `"Mon, 15 Jan 2024 10:00:00 +0000"` → `new Date(...).toISOString()` → `"2024-01-15T10:00:00Z"` |
| `currency` | Not in product response → use `store.metaData.currency` = `"INR"` |

---

## 3. EDGE CASES

### 3.1 Missing Data

| Scenario | Platform | Input | Output | Rule |
|---|---|---|---|---|
| SKU missing | WooCommerce | `"sku": ""` | `"sku": null` | Empty string → null |
| SKU field absent | Shopify | variant has no `sku` key | `"sku": null` | Missing key → null |
| Brand absent entirely | WooCommerce | No `brand` key in `meta_data` | `"brand": null` | Plugin not installed — field will not exist |
| Description absent | Magento | No entry in `custom_attributes` with `attribute_code === "description"` | `"description": null` | Key not found in array → null |
| Description empty string | Magento | `{ "attribute_code": "description", "value": "" }` | `"description": null` | Empty string → null |
| Category absent | Unicommerce | `"categoryCode": ""` | `"category": null` | Empty string → null |
| createdAt absent | Unicommerce | Field not in response | `"createdAt": null` | Not available → null |
| Tags absent | Magento | Not in response | `"tags": []` | Never null — always empty array |
| Images absent | Any | `images: []` or field missing | `"images": []` | Never null — always empty array |
| Variants absent | Magento simple | No variant array | Build synthetic variant | See synthetic variant rule |

---

### 3.2 Type Issues

| Scenario | Platform | Input | Output | Rule |
|---|---|---|---|---|
| Price is string | Shopify + WooCommerce | `"price": "2999.00"` | `"price": 2999` | `parseFloat()` always |
| Price is empty string | WooCommerce | `"price": ""` | `"price": null` | Empty string → null, skip offer record |
| Weight is string | WooCommerce | `"weight": "0.4"` | `"weight": 0.4` | `parseFloat()` |
| ID is number | Magento + BigCommerce | `"id": 2001` | `"sourceId": "2001"` | `.toString()` always |
| Status is number | Magento | `"status": 1` | `"status": "active"` | `1 → active`, `2 → inactive` |
| Boolean as string | Any | `"is_in_stock": "true"` | `"isInStock": true` | `=== "true"` comparison |
| Date not ISO 8601 | BigCommerce | `"Mon, 15 Jan 2024 10:00:00 +0000"` | `"2024-01-15T10:00:00.000Z"` | `new Date(dateStr).toISOString()` |
| Currency as symbol | Any | `"currency": "₹"` | `"currency": "INR"` | Always normalize to ISO 4217 |

---

### 3.3 Platform-Specific Edge Cases

#### Shopify
| Scenario | Input | Output | Rule |
|---|---|---|---|
| GID format ID | `"gid://shopify/Product/1001"` | `sourceId: "gid://shopify/Product/1001"` | Keep full GID as sourceId |
| `productType` field naming trap | `node.productType: "Footwear"` | `category: "Footwear"`, `productType: "unknown"` | Shopify `productType` → our `category`. Our `productType` = `"unknown"` |
| `compareAtPrice` is null | `"compareAtPrice": null` | `compareAtPrice: null`, `discountPercent: null` | Skip discount calculation entirely |
| `compareAtPrice` equals price | `price: "999"`, `compareAtPrice: "999"` | `compareAtPrice: null`, `discountPercent: null` | No real discount — treat as null |
| Trademark symbols in title | `"Nike® Air Max™"` | `cleanedTitle: "Nike Air Max"` | Strip `®™©` characters |
| Multiple media entries | `media.edges[]` has 5 items | `images[]` has 5 items | Map all — not just first |
| Variant with zero inventory | `inventoryQuantity: 0` | `isInStock: false`, `availability: "out_of_stock"` | Zero qty → out of stock |

#### Magento
| Scenario | Input | Output | Rule |
|---|---|---|---|
| Disabled image entry | `media_gallery_entries[].disabled: true` | Skip entry | Never include disabled images |
| Relative image path | `"file": "/m/o/shoe.jpg"` | `"url": "https://store.com/pub/media/catalog/product/m/o/shoe.jpg"` | Prepend `storeBaseUrl + /pub/media/catalog/product` |
| Full URL image path | `"file": "https://cdn.com/shoe.jpg"` | `"url": "https://cdn.com/shoe.jpg"` | Already full URL — use as-is |
| custom_attribute value empty | `{ "attribute_code": "brand", "value": "" }` | `brand: null` | Empty value → null |
| Status 2 | `"status": 2` | `"status": "inactive"` | `2 → inactive` |
| Category level 0 or 1 | `category.level: 0` or `1` | Skip category | Internal system nodes — not real merchant categories |
| No category links | `extension_attributes.category_links: []` | `categoryIds: []` | Empty array — valid |
| Configurable with no links | `configurable_product_links: []` | One synthetic variant from base | Treat as simple product |

#### WooCommerce
| Scenario | Input | Output | Rule |
|---|---|---|---|
| `sale_price` is empty string | `"sale_price": ""`, `"on_sale": false` | `price: parseFloat(regular_price)`, `compareAtPrice: null` | Check `on_sale === true` FIRST before using `sale_price` |
| `stock_quantity` is null | `"manage_stock": false`, `"stock_quantity": null` | Derive from `stock_status` | `"instock" → isInStock: true`, `"outofstock" → isInStock: false` |
| `stock_quantity` is null availability | `"stock_status": "instock"`, `"stock_quantity": null` | `inventoryQty: null`, `isInStock: true`, `availability: "in_stock"` | Cannot determine limited — use `in_stock` as safe default |
| Tags are objects | `"tags": [{"id": 35, "name": "casual"}]` | `"tags": ["casual"]` | Extract `.name` from each object |
| HTML in description | `"<p>Comfortable <b>sneakers</b></p>"` | `"Comfortable sneakers"` | Strip all HTML tags |
| Variable product | `"type": "variable"` | Fetch `/products/{id}/variations` | Separate API call required for variant details |
| Brand not installed | `"meta_data": []` (empty or no brand key) | `"brand": null` | Plugin-dependent — handle gracefully |
| `regular_price` when not on sale | `"on_sale": false`, `"regular_price": "999"` | `price: 999`, `compareAtPrice: null` | Not on sale → `compareAtPrice` is null |

#### Unicommerce
| Scenario | Input | Output | Rule |
|---|---|---|---|
| `blockedInventory` present | `"inventory": 58, "blockedInventory": 8` | `inventoryQty: 50` | ALWAYS subtract: `inventory - blockedInventory` |
| All inventory blocked | `"inventory": 10, "blockedInventory": 10` | `inventoryQty: 0`, `isInStock: false` | Result is 0 → out of stock |
| `enabled: false` | `"enabled": false` | `"status": "inactive"` | Disabled product → inactive |
| Price below MSP | `listingPrice: 800`, `msp: 850` | `price: 800`, `minimumSellingPrice: 850` | Store both — flag for business review, do not reject |
| No image URL | `"imageUrl": ""` or absent | `"images": []` | Empty/missing → empty array |
| No description | `"description": ""` | `"description": null` | Empty string → null |
| SKU as sourceId | `"skuCode": "AGS-CP-569"` | `sourceId: "AGS-CP-569"` | skuCode is the primary identifier in Unicommerce |
| Inventory only update | skuCode matches existing product | Update offer only | Unicommerce never creates products — only updates existing offer records |

#### BigCommerce
| Scenario | Input | Output | Rule |
|---|---|---|---|
| `brand_id` only | `"brand_id": 35` | `"brand": "Reebok"` | Requires `GET /v2/brands/35` — cannot resolve from product alone |
| `is_visible: false` | `"is_visible": false` | `"status": "inactive"` | Not visible = inactive |
| `retail_price === price` | `"price": 999`, `"retail_price": 999` | `compareAtPrice: null` | Same price = no discount |
| `retail_price > price` | `"price": 799`, `"retail_price": 999` | `compareAtPrice: 999` | Genuine discount |
| Non-ISO date | `"Mon, 15 Jan 2024 10:00:00 +0000"` | `"2024-01-15T10:00:00.000Z"` | `new Date(str).toISOString()` |
| Category IDs only | `"categories": [20, 21]` | Resolve from tree API | `GET /v2/catalog/trees/{id}/categories` required |
| `inventory_tracking: "product"` | Product-level tracking | Use `product.inventory_level` | Not variant-level — use base product qty for all variants |
| `inventory_tracking: "variant"` | Variant-level tracking | Use `variant.inventory_level` per variant | Standard case |
| `search_keywords: ""` | Empty string | `"tags": []` | Empty string → split → filter empty → `[]` |
| `option_set_id: null` | No options set | `attributes: {}` | Product has no configurable options |

---

### 3.4 Derived Field Edge Cases

| Field | Scenario | Rule |
|---|---|---|
| `discountPercent` | `originalPrice` is null | `discountPercent: null` — skip calculation |
| `discountPercent` | `originalPrice === price` | `discountPercent: null` — no real discount |
| `discountPercent` | `originalPrice < price` | `discountPercent: null` — invalid data, skip |
| `discountPercent` | `originalPrice > price` | `Math.round(((originalPrice - price) / originalPrice) * 100)` |
| `cleanedTitle` | Title has HTML | Strip all tags first, then strip symbols |
| `cleanedTitle` | Title is null | `cleanedTitle: null` |
| `normalizedBrand` | Brand is null | `normalizedBrand: null` |
| `normalizedBrand` | `"  NIKE  "` with spaces | `"nike"` — `.toLowerCase().trim()` |
| `pricePerUnit` | `unit_quantity` not in attributes | `pricePerUnit: null` |
| `pricePerUnit` | `unit_quantity: "0"` | `pricePerUnit: null` — avoid division by zero |

---

### 3.5 Availability Logic Edge Cases

Availability threshold is stored in `store.syncConfig.availabilityThreshold` (default: 10). Never hardcoded.

| Scenario | stockQty | isInStock | availability |
|---|---|---|---|
| Normal in stock | 50 | true | `"in_stock"` |
| Limited stock | 5 | true | `"limited"` |
| Out of stock | 0 | false | `"out_of_stock"` |
| Null qty, manage_stock false | null | true | `"in_stock"` — use stock_status |
| Null qty, manage_stock false, outofstock | null | false | `"out_of_stock"` |
| Unicommerce blocked | inventory 58, blocked 8 | true | Compute `availableQty = 50` first, then apply threshold |
| Exactly at threshold | qty === threshold (10) | true | `"limited"` — threshold is exclusive upper bound |

---

## 4. DATA CONSISTENCY RULES

| Rule | Detail |
|---|---|
| All IDs stored as strings | Even if platform returns numbers: `item.id → sourceId.toString()` |
| Currency always ISO 4217 | `"INR"`, `"USD"`, `"EUR"` — never `"₹"`, `"$"`, `"€"` |
| Arrays never null | `images`, `tags`, `variants`, `categoryIds` → always `[]` if empty, never `null` |
| Dates always ISO 8601 | `"2024-01-15T10:00:00Z"` — convert all non-standard formats |
| Price always number | Always `parseFloat()` — never store price as string |
| `lastSyncedAt` always system-generated | `new Date().toISOString()` — never from platform |
| HTML never stored | Strip from `description`, `cleanedTitle` before storing |
| Empty string treated as null | `""` → `null` for all optional string fields |
| `discountPercent` only when valid | Only compute when `originalPrice > price > 0` |
| Transformer never accesses credentials | Credentials stay in connector layer only |

---

## 5. CROSS-PLATFORM DEDUPLICATION RULES

When the same physical product appears in multiple platform mock files (same SKU, same brand):

| Rule | Detail |
|---|---|
| Products are per-source | Same SKU from Shopify and Magento = two separate product records |
| Offers link products to stores | Same product sold by two stores = two offer records, one product record (future — Week 5 product graph) |
| `sourceId` is unique per platform | Never use sourceId across platforms for matching |
| SKU-based matching | Cross-platform deduplication uses SKU as the join key (Week 5 scope) |
| Unicommerce match | `inventorySnapshot.itemTypeSKU` matches `product.sku` to update existing offer |

---

## 6. SUMMARY TABLE — WHAT EACH PLATFORM PROVIDES

| Field | Shopify | Magento | WooCommerce | Unicommerce | BigCommerce |
|---|---|---|---|---|---|
| Product title | ✅ | ✅ | ✅ | ✅ | ✅ |
| Description | ✅ | ⚠️ hidden | ⚠️ HTML | ✅ | ⚠️ HTML |
| Brand | ✅ vendor | ⚠️ hidden | ⚠️ plugin | ✅ | ⚠️ separate API |
| Category | ✅ as label | ⚠️ hidden | ✅ | ⚠️ code only | ⚠️ tree API |
| Product type | 🔴 | ✅ type_id | ✅ type | 🔴 | ✅ physical/digital |
| Tags | ✅ | 🔴 | ⚠️ objects | ⚠️ if available | ⚠️ comma string |
| Images | ✅ | ⚠️ relative path | ✅ | ⚠️ single URL | ✅ |
| Variants | ✅ | ⚠️ synthetic for simple | ⚠️ separate API for variable | 🔴 one per SKU | ⚠️ separate API |
| Price | ⚠️ string | ✅ | ⚠️ string + on_sale logic | ✅ listingPrice | ✅ |
| Original price | ✅ compareAtPrice | ⚠️ separate endpoint | ⚠️ regular_price + on_sale | ✅ maxRetailPrice | ✅ retail_price |
| Currency | ✅ | 🔴 use store default | 🔴 use store default | ✅ | 🔴 use store default |
| Stock qty | ✅ per variant | ✅ stock_item | ⚠️ null if unmanaged | ⚠️ subtract blocked | ✅ per variant |
| Product URL | ⚠️ construct from handle | ⚠️ construct from url_key | ✅ permalink | ✅ productPageUrl | ⚠️ construct from custom_url |
| Created date | ✅ | ✅ | ✅ | 🔴 | ⚠️ not ISO format |
| Updated date | ✅ | ✅ | ✅ | 🔴 | ⚠️ not ISO format |

**Legend:** ✅ Direct · ⚠️ Requires transformation · 🔴 Not available