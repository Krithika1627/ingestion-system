async function normalizePrice(rawPriceString) {
  const fallbackCurrency = 'USD';
  if (rawPriceString === null || rawPriceString === undefined) {
    return { amount: null, currency: fallbackCurrency };
  }

  const raw = String(rawPriceString).trim();
  if (!raw) {
    return { amount: null, currency: fallbackCurrency };
  }

  const upper = raw.toUpperCase();
  let currency = fallbackCurrency;

  if (/INR|RS\.?|RUPEE|RUPEES|\u20B9/.test(upper) || /\u20B9/.test(raw)) {
    currency = 'INR';
  } else if (/USD|US\$/.test(upper) || /\$/.test(raw)) {
    currency = 'USD';
  } else if (/EUR|\u20AC/.test(upper) || /\u20AC/.test(raw)) {
    currency = 'EUR';
  } else if (/GBP|\u00A3/.test(upper) || /\u00A3/.test(raw)) {
    currency = 'GBP';
  }

  const numericMatch = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  const amount = numericMatch ? parseFloat(numericMatch[1]) : null;

  return { amount: Number.isFinite(amount) ? amount : null, currency };
}

module.exports = { normalizePrice };
