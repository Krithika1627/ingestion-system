// scripts/fix-mock.js
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync('./mock-data/magento-mock.json', 'utf8'));

// Flatten all products into one array
const allProducts = raw.flatMap(entry => entry.products.items);

// Deduplicate categories by id
const categoryMap = {};
for (const entry of raw) {
  const cats = [entry.categories, ...(entry.categories.children_data || [])];
  for (const cat of cats) {
    if (cat.id && !categoryMap[cat.id]) {
      categoryMap[cat.id] = cat;
    }
  }
}

// Build the root categories node with level:1 added
const rootCategory = {
  id: 2,
  parent_id: 1,
  name: "Default Category",
  level: 1,
  children: "12,20,30",
  custom_attributes: [{ attribute_code: "url_key", value: "default-category" }],
  children_data: Object.values(categoryMap).filter(c => c.id !== 2)
};

const fixed = {
  products: {
    items: allProducts,
    total_count: allProducts.length
  },
  categories: rootCategory
};

fs.writeFileSync('./mock-data/magento-mock.json', JSON.stringify(fixed, null, 2));
console.log(`Done: ${allProducts.length} products, ${rootCategory.children_data.length} categories`);