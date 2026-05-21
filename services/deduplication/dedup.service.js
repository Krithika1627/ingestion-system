const mongoose = require('mongoose');
const logger = require('../logger.service');
const { connectDB } = require('../db.service');

const ABBREVIATIONS = new Map([
  ['qty', 'quantity'],
  ['pcs', 'pieces'],
  ['ml', 'milliliter'],
  ['kg', 'kilogram'],
  ['g', 'gram'],
  ['l', 'liter'],
  ['sz', 'size'],
  ['col', 'color'],
  ['blk', 'black'],
  ['wht', 'white'],
  ['rd', 'red']
]);

const FILLER_WORDS = new Set([
  'buy',
  'online',
  'india',
  'free',
  'shipping',
  'offer',
  'best',
  'price',
  'new',
  'latest',
  'original'
]);

function normalizeText(text) {
  if (!text) {
    return '';
  }

  const lower = String(text).toLowerCase();
  const cleaned = lower.replace(/[^a-z0-9\s-]/g, ' ');
  const tokens = cleaned
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .flatMap((token) => {
      const parts = token.split('-').filter(Boolean);
      if (parts.length === 0) {
        return [];
      }

      const mapped = parts
        .map((part) => ABBREVIATIONS.get(part) || part)
        .filter((part) => part && !FILLER_WORDS.has(part));

      if (mapped.length === 0) {
        return [];
      }

      return [mapped.join('-')];
    });

  return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

function normalizeBrand(brand) {
  if (!brand) {
    return null;
  }
  const normalized = String(brand).toLowerCase().trim();
  return normalized.length > 0 ? normalized : null;
}

function tokenSortRatio(str1, str2) {
  const normalizedA = normalizeText(str1);
  const normalizedB = normalizeText(str2);
  if (!normalizedA || !normalizedB) {
    return 0;
  }

  const sortedA = normalizedA.split(/\s+/).sort().join('');
  const sortedB = normalizedB.split(/\s+/).sort().join('');
  const maxLength = Math.max(sortedA.length, sortedB.length);
  if (maxLength === 0) {
    return 0;
  }

  const countsA = {};
  const countsB = {};
  for (const char of sortedA) {
    countsA[char] = (countsA[char] || 0) + 1;
  }
  for (const char of sortedB) {
    countsB[char] = (countsB[char] || 0) + 1;
  }

  let common = 0;
  Object.keys(countsA).forEach((char) => {
    if (countsB[char]) {
      common += Math.min(countsA[char], countsB[char]);
    }
  });

  return Math.max(0, Math.min(1, common / maxLength));
}

function scoreProductSimilarity(productA, productB) {
  const titleSimilarity = tokenSortRatio(
    productA?.cleanedTitle || productA?.title || '',
    productB?.cleanedTitle || productB?.title || ''
  );

  const brandA = normalizeBrand(productA?.brand || productA?.normalizedBrand);
  const brandB = normalizeBrand(productB?.brand || productB?.normalizedBrand);
  let brandMatch = 0;
  if (!brandA && !brandB) {
    brandMatch = 0.5;
  } else if (brandA && brandB && brandA === brandB) {
    brandMatch = 1;
  }

  const priceA = productA.variants?.[0]?.price;
  const priceB = productB.variants?.[0]?.price;

  if (priceA && priceB) {
    const priceDiff = Math.abs(priceA - priceB) / Math.max(priceA, priceB);
    if (priceDiff > 0.30) {
      return {
        score: 0,
        signals: { 
          titleSimilarity, 
          brandMatch, 
          priceProximity: null,    // not yet calculated
          categoryMatch: null      // not yet calculated
        },
        hardGate: 'price_diff_exceeded'
      };
    }
  }

  let priceProximity = 0.5;
  if (Number.isFinite(priceA) && Number.isFinite(priceB)) {
    const maxPrice = Math.max(priceA, priceB);
    priceProximity = maxPrice > 0
      ? 1 - Math.abs(priceA - priceB) / maxPrice
      : 0;
    priceProximity = Math.max(0, Math.min(1, priceProximity));
  }

  const categoryA = normalizeText(productA?.category || '');
  const categoryB = normalizeText(productB?.category || '');
  let categoryMatch = 0.5;
  if (categoryA && categoryB) {
    categoryMatch = categoryA === categoryB ? 1 : 0;
  }

  const score =
    titleSimilarity * 0.40 +
    brandMatch * 0.20 +
    priceProximity * 0.30 +
    categoryMatch * 0.10;

  return {
    score: Math.max(0, Math.min(1, score)),
    signals: {
      titleSimilarity,
      brandMatch,
      priceProximity,
      categoryMatch
    }
  };
}

async function findDuplicates(incomingProduct) {
  try {
    if (!incomingProduct) {
      return {
        isDuplicate: false,
        matchedProductId: null,
        matchedSourceId: null,
        confidence: null,
        signals: null,
        allMatches: []
      };
    }

    await connectDB();
    const collection = mongoose.connection.collection('products');

    const category = incomingProduct?.category || null;
    const normalizedBrand = normalizeBrand(
      incomingProduct?.normalizedBrand || incomingProduct?.brand
    );

    let filter = null;
    if (category) {
      filter = { category };
    } else if (normalizedBrand) {
      filter = { normalizedBrand };
    } else {
      return {
        isDuplicate: false,
        matchedProductId: null,
        matchedSourceId: null,
        confidence: null,
        signals: null,
        allMatches: []
      };
    }

    const candidates = await collection
      .find(filter)
      .limit(100)
      .project({
        id: 1,
        sourceId: 1,
        title: 1,
        brand: 1,
        normalizedBrand: 1,
        cleanedTitle: 1,
        category: 1,
        variants: 1
      })
      .toArray();

    const matches = [];
    for (const candidate of candidates) {
      const { score, signals } = scoreProductSimilarity(incomingProduct, candidate);
      if (score >= 0.85) {
        matches.push({
          id: candidate?.id || null,
          sourceId: candidate?.sourceId || null,
          score,
          signals
        });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    const best = matches[0];

    return {
      isDuplicate: Boolean(best?.id),
      matchedProductId: best?.id || null,
      matchedSourceId: best?.sourceId || null,
      confidence: best?.score || null,
      signals: best?.signals || null,
      allMatches: matches
    };
  } catch (error) {
    logger.error({
      message: 'Deduplication lookup failed',
      service: 'dedup',
      error: error?.message || String(error)
    });
    return {
      isDuplicate: false,
      matchedProductId: null,
      matchedSourceId: null,
      confidence: null,
      signals: null,
      allMatches: []
    };
  }
}

module.exports = {
  normalizeText,
  normalizeBrand,
  tokenSortRatio,
  scoreProductSimilarity,
  findDuplicates
};
