const logger = require('../services/logger.service');
const {
  resolveField,
  resolveConflicts,
  resolveVariants
} = require('../services/conflict-resolution/conflict.service');

function logResult({
  testCase,
  label,
  field,
  existingValue,
  incomingValue,
  winner,
  reason,
  correct
}) {
  logger.info({
    testCase,
    label,
    field,
    existingValue,
    incomingValue,
    winner,
    reason,
    correct
  });
}

function run() {
  let correctCount = 0;

  // 1. Shopify title vs scraped title -> Shopify wins
  const r1 = resolveField(
    'title',
    'Shopify iPhone 13',
    'Scraped iPhone 13',
    'shopify',
    'scraped',
    '2026-05-01T10:00:00Z',
    '2026-05-02T10:00:00Z'
  );
  const t1 = r1.winner === 'existing' && r1.reason === 'source_priority';
  logResult({
    testCase: 1,
    label: 'Shopify title beats scraped',
    field: 'title',
    existingValue: 'Shopify iPhone 13',
    incomingValue: 'Scraped iPhone 13',
    winner: r1.winner,
    reason: r1.reason,
    correct: t1
  });
  if (t1) correctCount += 1;

  // 2. Null existing title vs scraped title -> scraped wins
  const r2 = resolveField(
    'title',
    null,
    'Scraped Title',
    'shopify',
    'scraped',
    '2026-05-01T10:00:00Z',
    '2026-05-02T10:00:00Z'
  );
  const t2 = r2.winner === 'incoming' && r2.reason === 'null_fallback';
  logResult({
    testCase: 2,
    label: 'Null existing title falls back',
    field: 'title',
    existingValue: null,
    incomingValue: 'Scraped Title',
    winner: r2.winner,
    reason: r2.reason,
    correct: t2
  });
  if (t2) correctCount += 1;

  // 3. Same source, older sync vs newer sync -> newer wins
  const r3 = resolveField(
    'title',
    'Old Title',
    'New Title',
    'shopify',
    'shopify',
    '2026-05-01T10:00:00Z',
    '2026-05-03T10:00:00Z'
  );
  const t3 = r3.winner === 'incoming' && r3.reason === 'recency';
  logResult({
    testCase: 3,
    label: 'Recency wins on same source',
    field: 'title',
    existingValue: 'Old Title',
    incomingValue: 'New Title',
    winner: r3.winner,
    reason: r3.reason,
    correct: t3
  });
  if (t3) correctCount += 1;

  // 4. Same source/time, longer title wins
  const sameTime = '2026-05-03T10:00:00Z';
  const r4 = resolveField(
    'title',
    'Short',
    'Much Longer Title',
    'shopify',
    'shopify',
    sameTime,
    sameTime
  );
  const t4 = r4.winner === 'incoming' && r4.reason === 'completeness';
  logResult({
    testCase: 4,
    label: 'Completeness wins on tie',
    field: 'title',
    existingValue: 'Short',
    incomingValue: 'Much Longer Title',
    winner: r4.winner,
    reason: r4.reason,
    correct: t4
  });
  if (t4) correctCount += 1;

  // 5. Magento brand vs WooCommerce brand -> Magento wins
  const r5 = resolveField(
    'brand',
    'Acme',
    'BrandX',
    'magento',
    'woocommerce',
    '2026-05-02T10:00:00Z',
    '2026-05-02T10:00:00Z'
  );
  const t5 = r5.winner === 'existing' && r5.reason === 'source_priority';
  logResult({
    testCase: 5,
    label: 'Magento brand beats WooCommerce',
    field: 'brand',
    existingValue: 'Acme',
    incomingValue: 'BrandX',
    winner: r5.winner,
    reason: r5.reason,
    correct: t5
  });
  if (t5) correctCount += 1;

  // 6. Same SKU Shopify vs scraped -> Shopify price wins
  const v6 = resolveVariants(
    [{ sku: 'SKU1', price: 100, availability: 'in_stock' }],
    [{ sku: 'SKU1', price: 80, availability: 'out_of_stock' }],
    'shopify',
    'scraped'
  );
  const v6Variant = v6.mergedVariants[0] || {};
  const t6 = v6Variant.price === 100 && v6Variant.availability === 'in_stock';
  logResult({
    testCase: 6,
    label: 'Shopify variant price wins on conflict',
    field: 'variants',
    existingValue: 100,
    incomingValue: 80,
    winner: t6 ? 'existing' : 'incoming',
    reason: 'source_priority',
    correct: t6
  });
  if (t6) correctCount += 1;

  // 7. Shopify has 3 variants, scraped has 1 matching
  const existingVariants7 = [
    { sku: 'A', price: 10 },
    { sku: 'B', price: 20 },
    { sku: 'C', price: 30 }
  ];
  const incomingVariants7 = [{ sku: 'B', price: 5, note: 'scraped' }];
  const v7 = resolveVariants(existingVariants7, incomingVariants7, 'shopify', 'scraped');
  const matched7 = v7.mergedVariants.find((variant) => variant.sku === 'B');
  const t7 = v7.mergedVariants.length === 3 && matched7?.price === 20 && matched7?.note === 'scraped';
  logResult({
    testCase: 7,
    label: 'Variant count preserved with updates',
    field: 'variants',
    existingValue: 3,
    incomingValue: 1,
    winner: t7 ? 'existing' : 'incoming',
    reason: 'source_priority',
    correct: t7
  });
  if (t7) correctCount += 1;

  // 8. No SKU match -> incoming added
  const v8 = resolveVariants(
    [{ sku: 'SKU1', price: 100 }],
    [{ sku: 'SKU2', price: 120 }],
    'shopify',
    'scraped'
  );
  const t8 = v8.added === 1 && v8.mergedVariants.length === 2;
  logResult({
    testCase: 8,
    label: 'Incoming variant added when no match',
    field: 'variants',
    existingValue: 'SKU1',
    incomingValue: 'SKU2',
    winner: t8 ? 'incoming' : 'existing',
    reason: 'completeness',
    correct: t8
  });
  if (t8) correctCount += 1;

  // 9. Availability conflict -> higher priority source wins
  const v9 = resolveVariants(
    [{ sku: 'SKU9', availability: 'out_of_stock' }],
    [{ sku: 'SKU9', availability: 'in_stock' }],
    'magento',
    'woocommerce'
  );
  const v9Variant = v9.mergedVariants[0] || {};
  const t9 = v9Variant.availability === 'out_of_stock';
  logResult({
    testCase: 9,
    label: 'Higher priority availability wins',
    field: 'variants',
    existingValue: 'out_of_stock',
    incomingValue: 'in_stock',
    winner: t9 ? 'existing' : 'incoming',
    reason: 'source_priority',
    correct: t9
  });
  if (t9) correctCount += 1;

  // 10. Full product conflict
  const existingProduct = {
    title: 'Shopify Title',
    cleanedTitle: 'shopify title',
    brand: 'BrandA',
    normalizedBrand: 'branda',
    category: 'Phones',
    description: null,
    attributes: { color: 'red', size: 'M' },
    images: [{ url: 'https://img.example.com/a.jpg' }],
    source: 'shopify',
    lastSyncedAt: '2026-05-03T10:00:00Z'
  };

  const incomingProduct = {
    title: 'Scraped Title',
    cleanedTitle: 'scraped title',
    brand: 'BrandB',
    normalizedBrand: 'brandb',
    category: 'Phones',
    description: 'Detailed scraped description',
    attributes: { material: 'cotton', size: 'L' },
    images: [{ url: 'https://img.example.com/b.jpg' }],
    source: 'scraped',
    lastSyncedAt: '2026-05-04T10:00:00Z'
  };

  const r10 = resolveConflicts(existingProduct, incomingProduct);
  const resolved = r10.resolvedProduct;
  const t10 =
    resolved.title === 'Shopify Title' &&
    resolved.description === 'Detailed scraped description' &&
    resolved.images.length === 2 &&
    resolved.attributes.material === 'cotton' &&
    resolved.attributes.size === 'M';
  const titleConflict = r10.conflicts.find((conflict) => conflict.field === 'title');
  logResult({
    testCase: 10,
    label: 'Full product conflict resolution',
    field: 'product',
    existingValue: existingProduct.title,
    incomingValue: incomingProduct.title,
    winner: titleConflict?.winner || 'existing',
    reason: titleConflict?.reason || 'source_priority',
    correct: t10
  });
  if (t10) correctCount += 1;

  logger.info({ summary: `Correct: ${correctCount}/10` });
}

run();
