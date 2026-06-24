const mongoose = require('mongoose');
const logger = require('./logger.service');
const { connectDB, getCollection } = require('./db.service');
const { DataQualityIssue } = require('../models/data_quality_issue.model');

function checkSchemaConstraints(canonicalDoc) {
  const issues = [];
  if (!canonicalDoc) return issues;

  const { priceRange, title, images, brand } = canonicalDoc;

  /* -- PRICE checks (critical) -- */
  const priceMin = priceRange?.min;
  const currency = priceRange?.currency;

  if (priceMin === null || priceMin === undefined) {
    issues.push({
      canonicalProductId: canonicalDoc.canonicalId || null,
      issueCode: 'MISSING_PRICE',
      issueDescription: 'Product has no price data',
      severity: 'critical',
      affectedField: 'priceRange.min',
      affectedValue: priceMin
    });
  } else if (typeof priceMin !== 'number' || !Number.isFinite(priceMin)) {
    issues.push({
      canonicalProductId: canonicalDoc.canonicalId || null,
      issueCode: 'INVALID_PRICE_TYPE',
      issueDescription: `Price is not a number: ${priceMin}`,
      severity: 'critical',
      affectedField: 'priceRange.min',
      affectedValue: priceMin
    });
  } else if (priceMin <= 0) {
    issues.push({
      canonicalProductId: canonicalDoc.canonicalId || null,
      issueCode: 'INVALID_PRICE_VALUE',
      issueDescription: `Price must be greater than 0: ${priceMin}`,
      severity: 'critical',
      affectedField: 'priceRange.min',
      affectedValue: priceMin
    });
  }

  const priceMax = priceRange?.max;
  if (
    priceMin !== null &&
    priceMin !== undefined &&
    priceMax !== null &&
    priceMax !== undefined &&
    typeof priceMin === 'number' &&
    typeof priceMax === 'number' &&
    Number.isFinite(priceMin) &&
    Number.isFinite(priceMax) &&
    priceMin > priceMax
  ) {
    issues.push({
      canonicalProductId: canonicalDoc.canonicalId || null,
      issueCode: 'INVALID_PRICE_RANGE',
      issueDescription: 'Min price exceeds max price',
      severity: 'critical',
      affectedField: 'priceRange',
      affectedValue: { min: priceMin, max: priceMax }
    });
  }

  if (!title || (typeof title === 'string' && title.trim().length === 0)) {
    issues.push({
      canonicalProductId: canonicalDoc.canonicalId || null,
      issueCode: 'MISSING_TITLE',
      issueDescription: 'Product has no title',
      severity: 'critical',
      affectedField: 'title',
      affectedValue: title
    });
  }

  if (typeof title === 'string' && title.length > 500) {
    issues.push({
      canonicalProductId: canonicalDoc.canonicalId || null,
      issueCode: 'TITLE_TOO_LONG',
      issueDescription: `Title exceeds 500 characters: ${title.length} chars`,
      severity: 'critical',
      affectedField: 'title',
      affectedValue: title
    });
  }

  if (typeof title === 'string' && title.trim().length > 0 && /^[^a-zA-Z]+$/.test(title)) {
    issues.push({
      canonicalProductId: canonicalDoc.canonicalId || null,
      issueCode: 'INVALID_TITLE',
      issueDescription: 'Title contains no alphabetic characters',
      severity: 'critical',
      affectedField: 'title',
      affectedValue: title
    });
  }

  const imagesList = Array.isArray(images) ? images : [];

  if (imagesList.length === 0) {
    issues.push({
      canonicalProductId: canonicalDoc.canonicalId || null,
      issueCode: 'MISSING_IMAGES',
      issueDescription: 'Product has no images',
      severity: 'warning',
      affectedField: 'images',
      affectedValue: null
    });
  }

  for (const img of imagesList) {
    if (typeof img === 'string' && !img.startsWith('http')) {
      issues.push({
        canonicalProductId: canonicalDoc.canonicalId || null,
        issueCode: 'INVALID_IMAGE_URL',
        issueDescription: `Image URL is not a valid HTTP URL: ${img}`,
        severity: 'warning',
        affectedField: 'images',
        affectedValue: img
      });
    }
  }

  if (currency !== null && currency !== undefined && !/^[A-Z]{3}$/.test(currency)) {
    issues.push({
      canonicalProductId: canonicalDoc.canonicalId || null,
      issueCode: 'INVALID_CURRENCY',
      issueDescription: `Currency is not a valid ISO code: ${currency}`,
      severity: 'warning',
      affectedField: 'priceRange.currency',
      affectedValue: currency
    });
  }

  if (!brand || (typeof brand === 'string' && brand.trim().length === 0)) {
    issues.push({
      canonicalProductId: canonicalDoc.canonicalId || null,
      issueCode: 'MISSING_BRAND',
      issueDescription: 'Product has no brand',
      severity: 'warning',
      affectedField: 'brand',
      affectedValue: brand
    });
  }

  return issues;
}

function checkAnomalies(canonicalDoc, offers) {
  const issues = [];
  if (!canonicalDoc) return issues;

  const { priceRange, updatedAt } = canonicalDoc;
  const canonicalProductId = canonicalDoc.canonicalId || null;

  if (priceRange?.min && canonicalDoc.price_history) {
    const oldPrice = canonicalDoc.price_history;
    const newPrice = priceRange.min;

    if (
      typeof oldPrice === 'number' &&
      typeof newPrice === 'number' &&
      Number.isFinite(oldPrice) &&
      Number.isFinite(newPrice) &&
      oldPrice > 0
    ) {
      const percentChange = ((newPrice - oldPrice) / oldPrice) * 100;
      if (Math.abs(percentChange) > 50) {
        issues.push({
          canonicalProductId,
          issueCode: 'ANOMALOUS_PRICE_CHANGE',
          issueDescription: `Price changed by ${Math.abs(Math.round(percentChange))}% since last sync: ${oldPrice} → ${newPrice}`,
          severity: 'critical',
          affectedField: 'priceRange.min',
          affectedValue: { oldPrice, newPrice, percentChange: Math.round(percentChange) }
        });
      }
    }
  }

  const offersList = Array.isArray(offers) ? offers : [];
  const inStockCount = offersList.filter(
    (o) => o.availability === 'inStock' || o.availability === 'in_stock'
  ).length;

  if (inStockCount === 0 && priceRange?.min !== null && priceRange?.min !== undefined) {
    issues.push({
      canonicalProductId,
      issueCode: 'NO_STOCK_AVAILABLE',
      issueDescription: 'Product has pricing but no in-stock offers',
      severity: 'warning',
      affectedField: 'availability',
      affectedValue: null
    });
  }

  if (offersList.length === 0) {
    issues.push({
      canonicalProductId,
      issueCode: 'NO_OFFERS',
      issueDescription: 'Product has no offers in any store',
      severity: 'warning',
      affectedField: null,
      affectedValue: null
    });
  }

  if (updatedAt) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const updatedDate = new Date(updatedAt);
    if (!isNaN(updatedDate.getTime()) && updatedDate < thirtyDaysAgo) {
      issues.push({
        canonicalProductId,
        issueCode: 'STALE_PRODUCT',
        issueDescription: 'Product has not been updated in 30+ days',
        severity: 'warning',
        affectedField: 'updatedAt',
        affectedValue: updatedAt
      });
    }
  }

  return issues;
}

async function checkInconsistencies(canonicalDoc, allSourceProducts) {
  const issues = [];
  if (!canonicalDoc) return issues;

  const canonicalProductId = canonicalDoc.canonicalId || null;
  const sources = Array.isArray(canonicalDoc.sources) ? canonicalDoc.sources : [];

  await connectDB();
  const productsCollection = getCollection('products');

  const sourceProducts = Array.isArray(allSourceProducts) ? allSourceProducts : [];

  for (const sourceProduct of sourceProducts) {
    const sku = sourceProduct?.sku;
    if (!sku) continue;

    const conflictingDocs = await productsCollection
      .find({
        sku,
        canonicalProductId: { $ne: canonicalProductId }
      })
      .project({ canonicalProductId: 1, sku: 1 })
      .limit(1)
      .toArray();

    if (conflictingDocs.length > 0) {
      issues.push({
        canonicalProductId,
        issueCode: 'SKU_CONFLICT',
        issueDescription: `SKU ${sku} is mapped to multiple canonical products`,
        severity: 'critical',
        affectedField: 'sku',
        affectedValue: { sku, conflictingCanonicalId: conflictingDocs[0].canonicalProductId }
      });
      break; /* Only report once per product */
    }
  }

  const brands = sourceProducts
    .map((p) => p?.brand)
    .filter((b) => b !== null && b !== undefined && typeof b === 'string' && b.trim().length > 0)
    .map((b) => b.toLowerCase().trim());

  const uniqueBrands = [...new Set(brands)];

  if (uniqueBrands.length > 1) {
    issues.push({
      canonicalProductId,
      issueCode: 'BRAND_CONFLICT',
      issueDescription: `Conflicting brands across sources: ${uniqueBrands[0]} vs ${uniqueBrands[1]}`,
      severity: 'warning',
      affectedField: 'brand',
      affectedValue: uniqueBrands
    });
  }

  if (sources.length === 0) {
    issues.push({
      canonicalProductId,
      issueCode: 'NO_SOURCES',
      issueDescription: 'Canonical product has no source mappings',
      severity: 'warning',
      affectedField: 'sources',
      affectedValue: null
    });
  }

  return issues;
}

async function validateProduct(canonicalProductId) {
  const startTime = Date.now();
  await connectDB();

  const canonicalCollection = getCollection('canonical_products');
  const offersCollection = getCollection('offers');
  const productsCollection = getCollection('products');

  try {
    const canonicalDoc = await canonicalCollection.findOne({ canonicalId: canonicalProductId });
    if (!canonicalDoc) {
      logger.warn({
        message: 'Data quality validation skipped — product not found',
        service: 'data-quality',
        canonicalProductId
      });
      return { canonicalProductId, issuesFound: 0, issues: [] };
    }

    const offers = await offersCollection.find({ canonicalProductId }).toArray();

    const allSourceProducts = await productsCollection.find({ canonicalProductId }).toArray();

    const schemaIssues = checkSchemaConstraints(canonicalDoc);
    const anomalyIssues = checkAnomalies(canonicalDoc, offers);
    const inconsistencyIssues = await checkInconsistencies(canonicalDoc, allSourceProducts);

    const allDetectedIssues = [...schemaIssues, ...anomalyIssues, ...inconsistencyIssues];

    const sourcesList = Array.isArray(canonicalDoc.sources) ? canonicalDoc.sources : [];
    const primarySource = sourcesList.length > 0 ? sourcesList[0] : null;

    for (const issue of allDetectedIssues) {
      issue.source = primarySource?.source || issue.source || null;
      issue.storeId = primarySource?.storeId || issue.storeId || null;
    }

    for (const issue of allDetectedIssues) {
      await DataQualityIssue.updateOne(
        { canonicalProductId: issue.canonicalProductId, issueCode: issue.issueCode },
        {
          $set: {
            issueDescription: issue.issueDescription,
            severity: issue.severity,
            affectedField: issue.affectedField,
            affectedValue: issue.affectedValue,
            source: issue.source,
            storeId: issue.storeId,
            resolved: false,
            resolvedAt: null
          },
          $setOnInsert: { detectedAt: new Date() }
        },
        { upsert: true }
      );
    }

    const detectedCodes = allDetectedIssues.map((i) => i.issueCode);
    await DataQualityIssue.updateMany(
      {
        canonicalProductId,
        issueCode: { $nin: detectedCodes },
        resolved: false
      },
      { $set: { resolved: true, resolvedAt: new Date() } }
    );

    if (canonicalDoc.priceRange?.min !== null && canonicalDoc.priceRange?.min !== undefined) {
      await canonicalCollection.updateOne(
        { canonicalId: canonicalProductId },
        { $set: { price_history: canonicalDoc.priceRange.min } }
      );
    }

    const duration = Date.now() - startTime;

    logger.info({
      message: 'Data quality validation complete',
      service: 'data-quality',
      canonicalProductId,
      issuesFound: allDetectedIssues.length,
      durationMs: duration
    });

    return {
      canonicalProductId,
      issuesFound: allDetectedIssues.length,
      issues: allDetectedIssues
    };
  } catch (error) {
    logger.error({
      message: 'Data quality validation failed',
      service: 'data-quality',
      canonicalProductId,
      error: error?.message || String(error)
    });

    return { canonicalProductId, issuesFound: 0, issues: [], error: error?.message || String(error) };
  }
}

async function validateAllProducts(options = {}) {
  const startTime = Date.now();
  await connectDB();

  const { severity, limit } = options;
  const batchSize = 100;
  const canonicalCollection = getCollection('canonical_products');

  let totalChecked = 0;
  let totalIssuesFound = 0;
  let criticalCount = 0;
  let warningCount = 0;
  const productsWithIssues = new Set();

  let hasMore = true;
  let skip = 0;

  while (hasMore) {
    const docs = await canonicalCollection
      .find({})
      .skip(skip)
      .limit(batchSize)
      .toArray();

    if (docs.length === 0) break;

    for (const doc of docs) {
      const cid = doc.canonicalId;
      if (!cid) continue;

      const result = await validateProduct(cid);
      totalChecked += 1;

      if (result.issuesFound > 0) {
        const relevantIssues = severity
          ? result.issues.filter((i) => i.severity === severity)
          : result.issues;

        if (relevantIssues.length > 0) {
          productsWithIssues.add(cid);
          totalIssuesFound += relevantIssues.length;

          for (const issue of relevantIssues) {
            if (issue.severity === 'critical') criticalCount += 1;
            else if (issue.severity === 'warning') warningCount += 1;
          }
        }
      }

      if (limit && totalChecked >= limit) {
        hasMore = false;
        break;
      }
    }

    skip += batchSize;
    if (docs.length < batchSize) hasMore = false;
  }

  const durationMs = Date.now() - startTime;

  const summary = {
    totalChecked,
    totalIssuesFound,
    criticalCount,
    warningCount,
    productsWithIssues: productsWithIssues.size,
    durationMs
  };

  logger.info({
    message: 'Data quality full validation complete',
    service: 'data-quality',
    ...summary
  });

  return summary;
}

async function resolveIssue(issueId) {
  await connectDB();

  try {
    const issue = await DataQualityIssue.findByIdAndUpdate(
      issueId,
      { $set: { resolved: true, resolvedAt: new Date() } },
      { new: true }
    );

    if (!issue) {
      logger.warn({
        message: 'Data quality issue not found for resolution',
        service: 'data-quality',
        issueId
      });
      return null;
    }

    logger.info({
      message: 'Data quality issue resolved',
      service: 'data-quality',
      issueId,
      canonicalProductId: issue.canonicalProductId,
      issueCode: issue.issueCode
    });

    return issue;
  } catch (error) {
    logger.error({
      message: 'Failed to resolve data quality issue',
      service: 'data-quality',
      issueId,
      error: error?.message || String(error)
    });
    throw error;
  }
}

module.exports = {
  checkSchemaConstraints,
  checkAnomalies,
  checkInconsistencies,
  validateProduct,
  validateAllProducts,
  resolveIssue
};
