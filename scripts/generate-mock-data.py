import json
import random
from faker import Faker

fake = Faker()
Faker.seed(42)
random.seed(42)

CATEGORIES = [
    {"id": 12, "name": "Footwear", "slug": "footwear"},
    {"id": 13, "name": "Running Shoes", "slug": "running-shoes", "parent_id": 12},
    {"id": 20, "name": "Bags & Accessories", "slug": "bags-accessories"},
    {"id": 21, "name": "Handbags", "slug": "handbags", "parent_id": 20},
    {"id": 30, "name": "Electronics", "slug": "electronics"}
]
BRANDS = ["MockBrand", "MockLuxe", "MockTech", "MockFit", "MockStyle"]

def get_edge_cases():
    """Assigns edge cases based on exact required percentages."""
    r = random.random()
    
    # Stock Logic
    if r < 0.60: stock_qty = random.randint(11, 500)
    elif r < 0.80: stock_qty = random.randint(1, 10)
    elif r < 0.90: stock_qty = 0
    else: stock_qty = random.randint(5, 100) # buffer

    return {
        "stock_qty": stock_qty,
        "has_discount": random.random() < 0.50,
        "missing_brand": random.random() < 0.10,
        "missing_desc": random.random() < 0.05,
        "is_inactive": random.random() < 0.10,
        "has_variants": random.random() < 0.40,
        "empty_images": random.random() < 0.05
    }

def generate_base_product(idx):
    ec = get_edge_cases()
    
    brand = None if ec["missing_brand"] else random.choice(BRANDS)
    desc = None if ec["missing_desc"] else fake.paragraph(nb_sentences=2)
    category = random.choice(CATEGORIES)
    price = round(random.uniform(500, 10000), 2)
    compare_at_price = round(price * random.uniform(1.1, 1.5), 2) if ec["has_discount"] else None
    weight = round(random.uniform(0.1, 5.0), 2)
    
    images = [{"url": fake.image_url(), "alt": fake.sentence(), "position": i+1} for i in range(2)] if not ec["empty_images"] else []
    base_sku = f"MOCK-{fake.lexify(text='???').upper()}-{idx:04d}"
    
    variants = []
    if ec["has_variants"]:
        for size in ["S", "M", "L", "XL"]:
            v_price = price + random.randint(-100, 200)
            v_compare = round(v_price * 1.2, 2) if ec["has_discount"] else None
            variants.append({
                "sku": f"{base_sku}-{size}", "title": f"Size {size}", 
                "price": v_price, "compare_at_price": v_compare,
                "stock_qty": max(0, ec["stock_qty"] + random.randint(-2, 5))
            })
    else:
        variants.append({
            "sku": base_sku, "title": "Default", 
            "price": price, "compare_at_price": compare_at_price,
            "stock_qty": ec["stock_qty"]
        })

    return {
        "idx": idx, "sku": base_sku, "name": fake.word().capitalize() + " " + fake.word().capitalize(),
        "brand": brand, "category": category, "description": desc, "weight": weight,
        "images": images, "variants": variants, "ec": ec
    }

# ==========================================
# PLATFORM TRANSFORMERS
# ==========================================

def to_shopify(base):
    ec = base["ec"]
    status = "DRAFT" if ec["is_inactive"] else "ACTIVE"
    
    var_edges = []
    for i, v in enumerate(base["variants"]):
        var_edges.append({
            "node": {
                "id": f"gid://shopify/ProductVariant/{base['idx']*10 + i}",
                "title": v["title"], "sku": v["sku"],
                "price": str(v["price"]),
                "compareAtPrice": str(v["compare_at_price"]) if v["compare_at_price"] else None,
                "inventoryQuantity": v["stock_qty"]
            }
        })
        
    media_edges = [{"node": {"preview": {"image": {"url": img["url"]}}}} for img in base["images"]]
    min_price = min(v["price"] for v in base["variants"])
    max_price = max(v["price"] for v in base["variants"])
    
    # Generate a static collection list to reference
    collections = [
        {"node": {"id": "gid://shopify/Collection/301", "title": "Footwear", "handle": "footwear", "description": "All footwear", "updatedAt": fake.iso8601(), "image": {"url": fake.image_url()}, "productsCount": 50}},
        {"node": {"id": "gid://shopify/Collection/302", "title": "Electronics", "handle": "electronics", "description": "Gadgets", "updatedAt": fake.iso8601(), "image": {"url": fake.image_url()}, "productsCount": 50}}
    ]

    return {
        "data": {
            "products": {
                "edges": [{
                    "node": {
                        "id": f"gid://shopify/Product/{base['idx']}", "title": base["name"],
                        "description": base["description"], "vendor": base["brand"],
                        "productType": base["category"]["name"], "status": status,
                        "tags": [fake.word() for _ in range(3)],
                        "createdAt": fake.iso8601(), "updatedAt": fake.iso8601(),
                        "priceRangeV2": {
                            "minVariantPrice": {"amount": str(min_price), "currencyCode": "INR"},
                            "maxVariantPrice": {"amount": str(max_price), "currencyCode": "INR"}
                        },
                        "variants": {"edges": var_edges},
                        "media": {"edges": media_edges}
                    }
                }],
                "pageInfo": {"hasNextPage": False, "endCursor": "cursor_abc"}
            },
            "collections": {
                "edges": collections,
                "pageInfo": {"hasNextPage": False, "endCursor": "col_cursor"}
            }
        }
}

def to_magento(base):
    ec = base["ec"]
    status = 2 if ec["is_inactive"] else 1
    type_id = "configurable" if ec["has_variants"] else "simple"
    
    custom_attrs = [
        {"attribute_code": "description", "value": base["description"] or ""},
        {"attribute_code": "brand", "value": base["brand"] or ""},
        {"attribute_code": "url_key", "value": fake.slug()}
    ]
    
    media_gallery = []
    for img in base["images"]:
        media_gallery.append({
            "id": random.randint(1, 999), "media_type": "image", "label": img["alt"],
            "position": img["position"], "disabled": False, "types": ["image"],
            "file": f"/m/o/{base['sku']}.jpg"
        })

    return {
        "products": {
            "items": [{
                "id": base["idx"], "sku": base["sku"], "name": base["name"],
                "price": base["variants"][0]["price"], "status": status, "type_id": type_id,
                "weight": base["weight"], "created_at": fake.iso8601(), "updated_at": fake.iso8601(),
                "custom_attributes": custom_attrs,
                "extension_attributes": {
                    "category_links": [{"category_id": base["category"]["id"], "position": 0}],
                    "stock_item": {
                        "qty": base["variants"][0]["stock_qty"], 
                        "is_in_stock": base["variants"][0]["stock_qty"] > 0
                    }
                },
                "media_gallery_entries": media_gallery
            }],
            "total_count": 1
        },
        "categories": {
            "id": 2, "parent_id": 1, "name": "Default Category", "children": "12,20,30",
            "custom_attributes": [{"attribute_code": "url_key", "value": "default-category"}],
            "children_data": [
                {"id": base["category"]["id"], "parent_id": 2, "name": base["category"]["name"],
                 "level": 2, "path": f"1/2/{base['category']['id']}", "children": "",
                 "custom_attributes": [{"attribute_code": "url_key", "value": base["category"]["slug"]}],
                 "children_data": []}
            ]
        }
    }

def to_woocommerce(base):
    ec = base["ec"]
    status = "draft" if ec["is_inactive"] else "publish"
    type_name = "variable" if ec["has_variants"] else "simple"
    
    desc_html = f"<p>{base['description']}</p>" if base["description"] else ""
    v = base["variants"][0]
    
    return {
        "products": [{
            "id": base["idx"], "name": base["name"], "slug": fake.slug(),
            "permalink": f"https://mockstore.com/product/{base['sku']}/",
            "date_created": fake.date_time().strftime('%Y-%m-%dT%H:%M:%S'),
            "date_modified": fake.date_time().strftime('%Y-%m-%dT%H:%M:%S'),
            "type": type_name, "status": status, "description": desc_html,
            "sku": base["sku"], "price": str(v["price"]),
            "regular_price": str(v["compare_at_price"]) if v["compare_at_price"] else str(v["price"]),
            "sale_price": str(v["price"]) if v["compare_at_price"] else "", # Empty string edge case
            "on_sale": bool(v["compare_at_price"]), "manage_stock": True,
            "stock_quantity": v["stock_qty"],
            "stock_status": "instock" if v["stock_qty"] > 0 else "outofstock",
            "weight": str(base["weight"]),
            "categories": [{"id": base["category"]["id"], "name": base["category"]["name"]}],
            "tags": [{"id": random.randint(1,99), "name": fake.word()}],
            "images": [{"id": random.randint(1,99), "src": img["url"], "alt": img["alt"]} for img in base["images"]],
            "attributes": [{"id": 1, "name": "Size", "options": ["S", "M"]}],
            "variations": [base["idx"]*10 + i for i in range(len(base["variants"]))] if ec["has_variants"] else [],
            "meta_data": [{"key": "brand", "value": base["brand"]}] if base["brand"] else []
        }],
        "categories": [
            {"id": cat["id"], "name": cat["name"], "slug": cat["slug"], "parent": cat.get("parent_id", 0), 
             "image": {"src": fake.image_url()} if random.random() > 0.5 else None, "count": 10}
            for cat in CATEGORIES
        ]
    }

def to_bigcommerce(base):
    ec = base["ec"]
    
    bc_variants = []
    for v in base["variants"]:
        bc_variants.append({
            "id": base["idx"]*10 + len(bc_variants), "sku": v["sku"],
            "price": v["price"], 
            "retail_price": v["compare_at_price"] if v["compare_at_price"] else v["price"],
            "weight": base["weight"], "inventory_level": v["stock_qty"],
            "image_url": base["images"][0]["url"] if base["images"] else None,
            "option_values": [{"id": 1, "option_id": 1, "option_display_name": "Size", "label": v["title"]}]
        })
        
    desc_html = f"<p>{base['description']}</p>" if base["description"] else ""
    brand_id = random.randint(35, 40) if base["brand"] else None

    return {
        "productsAPI": {
            "data": [{
                "id": base["idx"], "name": base["name"], "type": "physical", "sku": base["sku"],
                "description": desc_html, "weight": base["weight"],
                "price": base["variants"][0]["price"], "retail_price": base["variants"][0].get("compare_at_price") or base["variants"][0]["price"],
                "sale_price": base["variants"][0]["price"] if base["variants"][0]["compare_at_price"] else 0.00, # BC uses 0.00 for no sale
                "is_visible": not ec["is_inactive"], "brand_id": brand_id,
                "categories": [base["category"]["id"]],
                "inventory_level": 0, "inventory_tracking": "variant" if ec["has_variants"] else "product",
                "search_keywords": f"{fake.word()},{fake.word()}",
                "custom_url": {"url": f"/{base['sku']}/", "is_customized": False},
                "primary_image": {"url_standard": base["images"][0]["url"] if base["images"] else None},
                "date_created": fake.iso8601(), "date_modified": fake.iso8601(),
                "variants": bc_variants
            }]
        },
                "brandsAPI": {
            "data": [
                {"id": 35, "name": "MockBrand"}, 
                {"id": 36, "name": "MockLuxe"}, 
                {"id": 37, "name": "MockTech"}, 
                {"id": 38, "name": "MockFit"}, 
                {"id": 39, "name": "MockStyle"}, 
                {"id": 40, "name": "GenericBrand"}
            ]
        },
        "categoryTreeAPI": {
            "tree_id": 1,
            "data": [
                {"id": cat["id"], "parent_id": cat.get("parent_id", 0), "name": cat["name"],
                 "url": f"/{cat['slug']}/", "image_url": fake.image_url() if random.random() > 0.5 else None}
                for cat in CATEGORIES
            ]
        }
    }

def to_unicommerce(base):
    ec = base["ec"]
    products = []
    inventory = []
    
    for v in base["variants"]:
        blocked = random.randint(0, 5) if v["stock_qty"] > 5 else 0
        products.append({
            "skuCode": v["sku"], "name": f"{base['name']} - {v['title']}",
            "description": base["description"], "brand": base["brand"],
            "categoryCode": base["category"]["name"], "enabled": not ec["is_inactive"],
            "imageUrl": base["images"][0]["url"] if base["images"] else None,
            "productPageUrl": f"https://mockstore.com/product/{v['sku']}",
            "itemPrice": {
                "currency": "INR", "listingPrice": v["price"],
                "maxRetailPrice": v["compare_at_price"] if v["compare_at_price"] else v["price"],
                "msp": round(v["price"] * 0.8, 2)
            }
        })
        inventory.append({
            "itemTypeSKU": v["sku"], "facilityCode": "FACILITY_DELHI_01",
            "inventory": v["stock_qty"], "blockedInventory": blocked
        })
        
    return {
        "productAPI": {"itemTypeDTOs": products},
        "inventoryAPI": {"inventorySnapshots": inventory}
    }

# ==========================================
# EXECUTION
# ==========================================
def main():
    NUM_RECORDS = 500
    platforms = {
        "shopify": to_shopify,
        "magento": to_magento,
        "woocommerce": to_woocommerce,
        "bigcommerce": to_bigcommerce,
        "unicommerce": to_unicommerce
    }

    print(f"Generating {NUM_RECORDS} records for {len(platforms)} platforms...")
    
    for platform_name, transformer_func in platforms.items():
        print(f"Generating {platform_name.upper()}...", end=" ", flush=True)
        output_data = []
        
        for i in range(1, NUM_RECORDS + 1):
            base_product = generate_base_product(i)
            platform_payload = transformer_func(base_product)
            output_data.append(platform_payload)
            
        filename = f"mock_{platform_name}_data.json"
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)
            
        print(f"Done -> {filename}")

    print("\nSuccess! Generated 2,500 total mock API responses.")

if __name__ == "__main__":
    main()