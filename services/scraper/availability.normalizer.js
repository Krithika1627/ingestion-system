function normalizeAvailability(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return 'unknown';
  }

  if (typeof rawValue === 'boolean') {
    return rawValue ? 'in_stock' : 'out_of_stock';
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (!normalized) {
    return 'unknown';
  }

  if (
    normalized.includes('in stock') ||
    normalized.includes('instock') ||
    normalized.includes('in-stock') ||
    normalized.includes('available') ||
    normalized.includes('ships immediately') ||
    normalized.includes('add to cart')
  ) {
    return 'in_stock';
  }

  if (
    normalized.includes('out of stock') ||
    normalized.includes('outofstock') ||
    normalized.includes('sold out') ||
    normalized.includes('unavailable') ||
    normalized.includes('not available')
  ) {
    return 'out_of_stock';
  }

  if (
    normalized.includes('only') ||
    normalized.includes('limited stock') ||
    normalized.includes('few left') ||
    normalized.includes('hurry') ||
    normalized.includes('low stock')
  ) {
    return 'limited_stock';
  }

  return 'unknown';
}

module.exports = { normalizeAvailability };
