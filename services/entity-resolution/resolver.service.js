const mongoose = require('mongoose');
const logger = require('../logger.service');
const { connectDB } = require('../db.service');
const {
  normalizeText,
  normalizeBrand,
  tokenSortRatio
} = require('../deduplication/dedup.service');

const MATCH_THRESHOLD = 0.80;

function getPrimaryPrice(product) {
  const price = product?.variants?.[0]?.price;
  return Number.isFinite(price) ? price : null;
}

function scoreAttributeMatch(productA, productB) {
  const normalizeAttrValue = (value) => {
    if (value === null || value === undefined) {
      return '';
    }

    const separated = String(value).replace(/([0-9])([a-zA-Z])/g, '$1 $2');
    const normalized = separated.toLowerCase();
    const withoutUnits = normalized.replace(
      /\b(milliliter|liter|kilogram|gram|pieces|quantity|size)\b/g,
      ''
    );
    return withoutUnits.replace(/\s+/g, '').trim();
  };

  const attrsA = productA?.attributes && typeof productA.attributes === 'object'
    ? productA.attributes
    : null;
  const attrsB = productB?.attributes && typeof productB.attributes === 'object'
    ? productB.attributes
    : null;

  if (!attrsA && !attrsB) {
    return 0.5;
  }

  if (!attrsA || !attrsB) {
    return 0.5;
  }

  const keysA = Object.keys(attrsA);
  const keysB = Object.keys(attrsB);
  const commonKeys = keysA.filter((key) => keysB.includes(key));

  if (commonKeys.length === 0) {
    return 0.5;
  }

  let matches = 0;
  for (const key of commonKeys) {
    const valueA = normalizeAttrValue(attrsA[key]);
    const valueB = normalizeAttrValue(attrsB[key]);
    if (valueA && valueB && valueA === valueB) {
      matches += 1;
    }
  }

  return matches / commonKeys.length;
}

function scoreEntitySimilarity(productA, productB) {
  const skuA = typeof productA?.sku === 'string' ? productA.sku.trim() : null;
  const skuB = typeof productB?.sku === 'string' ? productB.sku.trim() : null;

  const titleA = normalizeText(productA?.cleanedTitle || productA?.title || '');
  const titleB = normalizeText(productB?.cleanedTitle || productB?.title || '');
  const titleSimilarity = tokenSortRatio(titleA, titleB);

  const brandA = normalizeBrand(productA?.brand || productA?.normalizedBrand);
  const brandB = normalizeBrand(productB?.brand || productB?.normalizedBrand);
  let brandMatch = 0;
  if (!brandA && !brandB) {
    brandMatch = 0.5;
  } else if (brandA && brandB && brandA === brandB) {
    brandMatch = 1;
  }

  const priceA = getPrimaryPrice(productA);
  const priceB = getPrimaryPrice(productB);
  let priceProximity = 0.5;
  if (priceA !== null && priceB !== null) {
    const maxPrice = Math.max(priceA, priceB);
    const diffRatio = maxPrice > 0 ? Math.abs(priceA - priceB) / maxPrice : 0;
    if (diffRatio > 0.3) {
      return {
        score: 0,
        hardMatch: null,
        hardGate: 'price_diff_exceeded',
        signals: {
          titleSimilarity,
          brandMatch,
          priceProximity: Math.max(0, 1 - diffRatio),
          categoryMatch: 0.5,
          attributeMatch: 0.5
        }
      };
    }
    priceProximity = Math.max(0, Math.min(1, 1 - diffRatio));
  }

  const categoryA = normalizeText(productA?.category || '');
  const categoryB = normalizeText(productB?.category || '');
  let categoryMatch = 0.5;
  if (categoryA && categoryB) {
    categoryMatch = categoryA === categoryB ? 1 : 0;
  }

  const attributeMatch = scoreAttributeMatch(productA, productB);

  const baseScore =
    titleSimilarity * 0.35 +
    brandMatch * 0.2 +
    priceProximity * 0.25 +
    categoryMatch * 0.1 +
    attributeMatch * 0.1;

  if (skuA && skuB) {
    if (skuA === skuB) {
      return {
        score: 1,
        hardMatch: 'sku',
        hardGate: null,
        signals: {
          titleSimilarity,
          brandMatch,
          priceProximity,
          categoryMatch,
          attributeMatch
        }
      };
    }

    return {
      score: Math.min(0.7, baseScore),
      hardMatch: null,
      hardGate: 'sku_mismatch',
      signals: {
        titleSimilarity,
        brandMatch,
        priceProximity,
        categoryMatch,
        attributeMatch
      }
    };
  }

  return {
    score: Math.max(0, Math.min(1, baseScore)),
    hardMatch: null,
    hardGate: null,
    signals: {
      titleSimilarity,
      brandMatch,
      priceProximity,
      categoryMatch,
      attributeMatch
    }
  };
}

async function resolveProduct(incomingProduct) {
  const timestamp = new Date().toISOString();
  const canonicalId =
    typeof incomingProduct?.canonicalProductId === 'string' &&
    incomingProduct.canonicalProductId.startsWith('cprod_')
      ? incomingProduct.canonicalProductId
      : null;

  try {
    if (!incomingProduct) {
      return {
        resolved: false,
        canonicalProductId: null,
        matchedProductId: null,
        matchedSourceId: null,
        confidence: null,
        hardMatch: null,
        signals: null,
        allMatches: [],
        candidatesScored: 0
      };
    }

    await connectDB();
    const collection = mongoose.connection.collection('products');

    if (canonicalId) {
      const resolvedResult = {
        resolved: true,
        canonicalProductId: canonicalId,
        matchedProductId: null,
        matchedSourceId: incomingProduct?.sourceId || null,
        confidence: 1,
        hardMatch: 'canonical',
        signals: null,
        allMatches: [],
        candidatesScored: 0
      };

      logger.info({
        sourceId: incomingProduct?.sourceId || null,
        source: incomingProduct?.source || null,
        candidatesScored: 0,
        resolved: true,
        confidence: 1,
        hardMatch: 'canonical',
        canonicalProductId: canonicalId,
        timestamp
      });

      return resolvedResult;
    }

    const category = incomingProduct?.category || null;
    const normalizedBrand = normalizeBrand(
      incomingProduct?.normalizedBrand || incomingProduct?.brand
    );

    let filter = null;
    if (category && normalizedBrand) {
      filter = { category, normalizedBrand };
    } else if (normalizedBrand) {
      filter = { normalizedBrand };
    } else if (category) {
      filter = { category };
    } else {
      const titleSource = incomingProduct?.cleanedTitle || incomingProduct?.title || '';
      const normalizedTitle = normalizeText(titleSource);
      const tokens = normalizedTitle.split(/\s+/).filter(Boolean);
      if (tokens.length < 3) {
        return {
          resolved: false,
          canonicalProductId: null,
          matchedProductId: null,
          matchedSourceId: null,
          confidence: null,
          hardMatch: null,
          signals: null,
          allMatches: [],
          candidatesScored: 0
        };
      }

      const keywords = tokens.slice(0, 3);
      const pattern = keywords.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      filter = { cleanedTitle: { $regex: pattern, $options: 'i' } };
    }

    if (incomingProduct?.sourceId) {
      filter.sourceId = { $ne: incomingProduct.sourceId };
    }

    const candidates = await collection
      .find(filter)
      .limit(200)
      .project({
        id: 1,
        sourceId: 1,
        title: 1,
        cleanedTitle: 1,
        brand: 1,
        normalizedBrand: 1,
        category: 1,
        attributes: 1,
        variants: 1,
        sku: 1
      })
      .toArray();

    const matches = [];
    for (const candidate of candidates) {
      const scored = scoreEntitySimilarity(incomingProduct, candidate);
      if (scored.score >= MATCH_THRESHOLD) {
        matches.push({
          id: candidate?.id || null,
          sourceId: candidate?.sourceId || null,
          score: scored.score,
          signals: scored.signals,
          hardMatch: scored.hardMatch || null
        });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    const best = matches[0] || null;

    const result = {
      resolved: Boolean(best?.id),
      canonicalProductId: null,
      matchedProductId: best?.id || null,
      matchedSourceId: best?.sourceId || null,
      confidence: best?.score || null,
      hardMatch: best?.hardMatch || null,
      signals: best?.signals || null,
      allMatches: matches,
      candidatesScored: candidates.length
    };

    logger.info({
      sourceId: incomingProduct?.sourceId || null,
      source: incomingProduct?.source || null,
      candidatesScored: candidates.length,
      resolved: result.resolved,
      confidence: result.confidence,
      hardMatch: result.hardMatch,
      canonicalProductId: result.canonicalProductId,
      matchedProductId: result.matchedProductId,
      matchedSourceId: result.matchedSourceId,
      timestamp
    });

    return result;
  } catch (error) {
    logger.error({
      message: 'Entity resolution failed',
      service: 'entity-resolution',
      error: error?.message || String(error)
    });
    return {
      resolved: false,
      canonicalProductId: null,
      matchedProductId: null,
      matchedSourceId: null,
      confidence: null,
      hardMatch: null,
      signals: null,
      allMatches: [],
      candidatesScored: 0
    };
  }
}

async function resolveAllProducts(options = {}) {
  const start = Date.now();
  const sourceFilter = options?.source || null;
  const batchSize = Number.isFinite(options?.batchSize) ? options.batchSize : 50;
  const dryRun = Boolean(options?.dryRun);

  await connectDB();
  const collection = mongoose.connection.collection('products');

  const filter = sourceFilter ? { source: sourceFilter } : {};
  const total = await collection.countDocuments(filter);
  const cursor = collection.find(filter).batchSize(batchSize);

  let processed = 0;
  let resolved = 0;
  let unresolved = 0;
  let skipped = 0;
  let confidenceSum = 0;
  const results = [];

  for await (const product of cursor) {
    processed += 1;

    const category = product?.category || null;
    const normalizedBrand = normalizeBrand(product?.normalizedBrand || product?.brand);
    if (!category && !normalizedBrand) {
      skipped += 1;
    } else {
      const resolution = await resolveProduct(product);
      if (resolution.resolved) {
        resolved += 1;
        confidenceSum += resolution.confidence || 0;
        results.push({
          sourceId: product?.sourceId || null,
          matchedProductId: resolution.matchedProductId,
          confidence: resolution.confidence
        });
      } else {
        unresolved += 1;
      }

      if (!dryRun && resolution.resolved) {
        logger.info({
          message: 'Entity resolution match',
          service: 'entity-resolution',
          sourceId: product?.sourceId || null,
          matchedProductId: resolution.matchedProductId,
          confidence: resolution.confidence
        });
      }
    }

    if (processed % 50 === 0) {
      logger.info({
        message: 'Entity resolution progress',
        service: 'entity-resolution',
        processed,
        resolved,
        unresolved,
        skipped,
        totalSoFar: processed
      });
    }
  }

  const duration = Number(((Date.now() - start) / 1000).toFixed(2));
  const denominator = total - skipped;
  const resolutionRate = denominator > 0 ? resolved / denominator : 0;
  const averageConfidence = resolved > 0 ? confidenceSum / resolved : 0;

  return {
    total,
    resolved,
    unresolved,
    skipped,
    resolutionRate,
    averageConfidence,
    duration,
    results
  };
}

async function measureAccuracy(groundTruthPairs) {
  try {
    await connectDB();
    const collection = mongoose.connection.collection('products');

    const pairs = Array.isArray(groundTruthPairs) ? groundTruthPairs : [];
    let correct = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    const details = [];

    for (const pair of pairs) {
      const productA = await collection.findOne({ sourceId: pair?.sourceIdA || null });
      const productB = await collection.findOne({ sourceId: pair?.sourceIdB || null });

      const scored = productA && productB
        ? scoreEntitySimilarity(productA, productB)
        : { score: 0, hardMatch: null, hardGate: null, signals: null };

      const predicted = scored.score >= MATCH_THRESHOLD;
      const expected = Boolean(pair?.shouldMatch);

      if (predicted === expected) {
        correct += 1;
      } else if (predicted && !expected) {
        falsePositives += 1;
      } else if (!predicted && expected) {
        falseNegatives += 1;
      }

      details.push({
        label: pair?.label || null,
        sourceIdA: pair?.sourceIdA || null,
        sourceIdB: pair?.sourceIdB || null,
        expected,
        predicted,
        score: scored.score,
        signals: scored.signals,
        hardMatch: scored.hardMatch,
        hardGate: scored.hardGate
      });
    }

    const total = pairs.length;
    const accuracy = total > 0 ? correct / total : 0;

    return {
      total,
      correct,
      falsePositives,
      falseNegatives,
      accuracy,
      details
    };
  } catch (error) {
    logger.error({
      message: 'Accuracy measurement failed',
      service: 'entity-resolution',
      error: error?.message || String(error)
    });
    return {
      total: 0,
      correct: 0,
      falsePositives: 0,
      falseNegatives: 0,
      accuracy: 0,
      details: []
    };
  }
}

module.exports = {
  scoreEntitySimilarity,
  resolveProduct,
  resolveAllProducts,
  measureAccuracy
};
