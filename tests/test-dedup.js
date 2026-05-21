const logger = require('../services/logger.service');
const { scoreProductSimilarity } = require('../services/deduplication/dedup.service');

function buildProduct({ title, brand, price, category }) {
  return {
    title,
    cleanedTitle: title,
    brand: brand || null,
    normalizedBrand: brand ? brand.toLowerCase().trim() : null,
    category: category || null,
    variants: [
      {
        price: Number.isFinite(price) ? price : null,
        currency: 'INR'
      }
    ]
  };
}

const TEST_PAIRS = [
  {
    label: 'Exact match',
    a: buildProduct({ title: 'Nike Air Max 90', brand: 'Nike', price: 9999, category: 'Shoes' }),
    b: buildProduct({ title: 'Nike Air Max 90', brand: 'Nike', price: 9999, category: 'Shoes' }),
    shouldMatch: true
  },
  {
    label: 'Title variation',
    a: buildProduct({ title: 'Nike Air Max 90', brand: 'Nike', price: 10999, category: 'Shoes' }),
    b: buildProduct({ title: 'Nike Airmax 90', brand: 'Nike', price: 10999, category: 'Shoes' }),
    shouldMatch: true
  },
  {
    label: 'Brand null price close',
    a: buildProduct({ title: 'Classic Cotton T-Shirt', brand: null, price: 499, category: 'Apparel' }),
    b: buildProduct({ title: 'Classic Cotton T-Shirt', brand: null, price: 520, category: 'Apparel' }),
    shouldMatch: true
  },
  {
    label: 'Word order diff',
    a: buildProduct({ title: 'Black Cotton T-Shirt', brand: 'Acme', price: 799, category: 'Apparel' }),
    b: buildProduct({ title: 'Cotton T-Shirt Black', brand: 'Acme', price: 799, category: 'Apparel' }),
    shouldMatch: true
  },
  {
    label: 'Price within 8%',
    a: buildProduct({ title: 'Apple iPhone 13', brand: 'Apple', price: 55999, category: 'Phones' }),
    b: buildProduct({ title: 'Apple iPhone 13 Black', brand: 'Apple', price: 60500, category: 'Phones' }),
    shouldMatch: true
  },
  {
    label: 'Different titles and brands',
    a: buildProduct({ title: 'Samsung Galaxy S22', brand: 'Samsung', price: 65000, category: 'Phones' }),
    b: buildProduct({ title: 'Nike Air Max 90', brand: 'Nike', price: 9999, category: 'Shoes' }),
    shouldMatch: false
  },
  {
    label: 'Same brand different titles',
    a: buildProduct({ title: 'Nike Running Shorts', brand: 'Nike', price: 1999, category: 'Apparel' }),
    b: buildProduct({ title: 'Nike Football Shoes', brand: 'Nike', price: 6999, category: 'Shoes' }),
    shouldMatch: false
  },
  {
    label: 'Size variants treated different',
    a: buildProduct({ title: 'Cotton T-Shirt Size M', brand: 'Acme', price: 499, category: 'Apparel' }),
    b: buildProduct({ title: 'Cotton T-Shirt Size XL', brand: 'Acme', price: 499, category: 'Apparel' }),
    shouldMatch: true
  },
  {
    label: 'Same category different brand',
    a: buildProduct({ title: 'Organic Face Wash', brand: 'BrandA', price: 349, category: 'Skincare' }),
    b: buildProduct({ title: 'Herbal Face Wash', brand: 'BrandB', price: 349, category: 'Skincare' }),
    shouldMatch: false
  },
  {
    label: 'Price differs by 60%',
    a: buildProduct({ title: 'Bluetooth Speaker Mini', brand: 'SoundMax', price: 1999, category: 'Electronics' }),
    b: buildProduct({ title: 'Bluetooth Speaker Mini', brand: 'SoundMax', price: 3200, category: 'Electronics' }),
    shouldMatch: false
  }
];

function run() {
  let correct = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  TEST_PAIRS.forEach((pair, index) => {
    const { score, signals } = scoreProductSimilarity(pair.a, pair.b);
    const predicted = score >= 0.85;
    const expected = pair.shouldMatch;

    if (predicted === expected) {
      correct += 1;
    } else if (predicted && !expected) {
      falsePositives += 1;
    } else if (!predicted && expected) {
      falseNegatives += 1;
    }

    logger.info({
      testCase: index + 1,
      label: pair.label,
      expectedMatch: expected,
      predictedMatch: predicted,
      score,
      signals
    });
  });

  logger.info({
    summary: `Correct: ${correct}/10`,
    falsePositives,
    falseNegatives
  });
}

run();
