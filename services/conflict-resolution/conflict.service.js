const mongoose = require('mongoose');
const logger = require('../logger.service');
const { connectDB } = require('../db.service');
const { getOrCreateCanonical } = require('../canonical/canonical.service');

const SOURCE_PRIORITY = {
  shopify: 1,
  magento: 2,
  woocommerce: 3,
  bigcommerce: 4,
  unicommerce: 5,
  scraped: 6
};

function getSourcePriority(source) {
  if (!source) {
    return 99;
  }

  const key = String(source).toLowerCase();
  return SOURCE_PRIORITY[key] ?? 99;
}

function higherPrioritySource(sourceA, sourceB) {
  const priorityA = getSourcePriority(sourceA);
  const priorityB = getSourcePriority(sourceB);

  if (priorityA <= priorityB) {
    return 'a';
  }

  return 'b';
}

function isEmptyValue(value) {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }

  return false;
}

function parseTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function resolveField(
  fieldName,
  existingValue,
  incomingValue,
  existingSource,
  incomingSource,
  existingSyncedAt,
  incomingSyncedAt
) {
  if (isEmptyValue(existingValue)) {
    return {
      winner: 'incoming',
      value: incomingValue,
      reason: 'null_fallback'
    };
  }

  if (isEmptyValue(incomingValue)) {
    return {
      winner: 'existing',
      value: existingValue,
      reason: 'null_fallback'
    };
  }

  const existingPriority = getSourcePriority(existingSource);
  const incomingPriority = getSourcePriority(incomingSource);
  if (existingPriority !== incomingPriority) {
    const winner = existingPriority < incomingPriority ? 'existing' : 'incoming';
    return {
      winner,
      value: winner === 'existing' ? existingValue : incomingValue,
      reason: 'source_priority'
    };
  }

  const existingTime = parseTimestamp(existingSyncedAt);
  const incomingTime = parseTimestamp(incomingSyncedAt);
  if (existingTime && incomingTime && existingTime.getTime() !== incomingTime.getTime()) {
    const winner = existingTime > incomingTime ? 'existing' : 'incoming';
    return {
      winner,
      value: winner === 'existing' ? existingValue : incomingValue,
      reason: 'recency'
    };
  }

  if (existingTime && !incomingTime) {
    return {
      winner: 'existing',
      value: existingValue,
      reason: 'recency'
    };
  }

  if (!existingTime && incomingTime) {
    return {
      winner: 'incoming',
      value: incomingValue,
      reason: 'recency'
    };
  }

  if (typeof existingValue === 'string' && typeof incomingValue === 'string') {
    if (incomingValue.length > existingValue.length) {
      return {
        winner: 'incoming',
        value: incomingValue,
        reason: 'completeness'
      };
    }
    return {
      winner: 'existing',
      value: existingValue,
      reason: 'completeness'
    };
  }

  if (Array.isArray(existingValue) && Array.isArray(incomingValue)) {
    if (incomingValue.length > existingValue.length) {
      return {
        winner: 'incoming',
        value: incomingValue,
        reason: 'completeness'
      };
    }
    return {
      winner: 'existing',
      value: existingValue,
      reason: 'completeness'
    };
  }

  return {
    winner: 'existing',
    value: existingValue,
    reason: 'existing_kept'
  };
}

function getCanonicalSource(canonicalProduct) {
  if (canonicalProduct?.source) {
    return canonicalProduct.source;
  }

  if (Array.isArray(canonicalProduct?.sources) && canonicalProduct.sources.length > 0) {
    return canonicalProduct.sources[0];
  }

  return null;
}

function areValuesEqual(valueA, valueB) {
  if (valueA === valueB) {
    return true;
  }

  const aIsArray = Array.isArray(valueA);
  const bIsArray = Array.isArray(valueB);
  if (aIsArray || bIsArray) {
    if (!aIsArray || !bIsArray || valueA.length !== valueB.length) {
      return false;
    }

    for (let i = 0; i < valueA.length; i += 1) {
      if (valueA[i] !== valueB[i]) {
        return false;
      }
    }

    return true;
  }

  return false;
}

function mergeAttributes(
  existingAttributes,
  incomingAttributes,
  existingSource,
  incomingSource,
  existingSyncedAt,
  incomingSyncedAt,
  conflicts
) {
  const output = { ...(existingAttributes || {}) };
  const incoming = incomingAttributes && typeof incomingAttributes === 'object'
    ? incomingAttributes
    : {};

  Object.keys(incoming).forEach((key) => {
    const existingValue = output[key];
    const incomingValue = incoming[key];
    if (areValuesEqual(existingValue, incomingValue)) {
      return;
    }

    const decision = resolveField(
      `attributes.${key}`,
      existingValue,
      incomingValue,
      existingSource,
      incomingSource,
      existingSyncedAt,
      incomingSyncedAt
    );

    output[key] = decision.value;
    conflicts.push({
      field: `attributes.${key}`,
      existingValue,
      incomingValue,
      winner: decision.winner,
      reason: decision.reason,
      existingSource,
      incomingSource
    });
  });

  return output;
}

function getImageKey(image) {
  if (!image) {
    return null;
  }

  if (typeof image === 'string') {
    const trimmed = image.trim();
    return trimmed || null;
  }

  if (typeof image === 'object') {
    const url = image.url || image.src || image.href || image.id;
    if (url) {
      return String(url).trim();
    }

    try {
      return JSON.stringify(image);
    } catch (error) {
      return String(image);
    }
  }

  return String(image).trim();
}

function mergeImages(existingImages, incomingImages) {
  const merged = [];
  const seen = new Set();
  const addImage = (image) => {
    const key = getImageKey(image);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(image);
  };

  (Array.isArray(existingImages) ? existingImages : []).forEach(addImage);
  (Array.isArray(incomingImages) ? incomingImages : []).forEach(addImage);
  return merged;
}

function resolveConflicts(canonicalProduct, incomingProduct) {
  const existingSource = getCanonicalSource(canonicalProduct);
  const incomingSource = incomingProduct?.source || null;
  const existingSyncedAt =
    canonicalProduct?.updatedAt || canonicalProduct?.lastSyncedAt || canonicalProduct?.createdAt;
  const incomingSyncedAt = incomingProduct?.lastSyncedAt || incomingProduct?.updatedAt;

  const resolvedProduct = { ...(canonicalProduct || {}) };
  const conflicts = [];

  const resolveSimpleField = (field) => {
    const existingValue = canonicalProduct?.[field];
    const incomingValue = incomingProduct?.[field];
    const decision = resolveField(
      field,
      existingValue,
      incomingValue,
      existingSource,
      incomingSource,
      existingSyncedAt,
      incomingSyncedAt
    );

    resolvedProduct[field] = decision.value;
    if (!areValuesEqual(existingValue, incomingValue)) {
      conflicts.push({
        field,
        existingValue,
        incomingValue,
        winner: decision.winner,
        reason: decision.reason,
        existingSource,
        incomingSource
      });
    }
  };

  resolveSimpleField('title');
  resolveSimpleField('cleanedTitle');
  resolveSimpleField('brand');
  resolveSimpleField('normalizedBrand');
  resolveSimpleField('category');
  resolveSimpleField('description');

  resolvedProduct.attributes = mergeAttributes(
    canonicalProduct?.attributes,
    incomingProduct?.attributes,
    existingSource,
    incomingSource,
    existingSyncedAt,
    incomingSyncedAt,
    conflicts
  );

  resolvedProduct.images = mergeImages(
    canonicalProduct?.images,
    incomingProduct?.images
  );

  resolvedProduct.lastSyncedAt = new Date().toISOString();

  return {
    resolvedProduct,
    conflicts,
    hasConflicts: conflicts.length > 0,
    conflictCount: conflicts.length
  };
}

function getVariantKey(variant) {
  const sku = typeof variant?.sku === 'string' ? variant.sku.trim() : '';
  if (sku) {
    return `sku:${sku.toLowerCase()}`;
  }

  const variantId = variant?.variantId ?? variant?.id ?? null;
  if (!variantId) {
    return null;
  }

  return `variant:${String(variantId)}`;
}

function hasVariantChanged(existingVariant, mergedVariant) {
  const keys = new Set([
    ...Object.keys(existingVariant || {}),
    ...Object.keys(mergedVariant || {})
  ]);

  for (const key of keys) {
    const existingValue = existingVariant?.[key];
    const mergedValue = mergedVariant?.[key];
    if (existingValue === mergedValue) {
      continue;
    }

    const existingJson = typeof existingValue === 'object'
      ? JSON.stringify(existingValue)
      : existingValue;
    const mergedJson = typeof mergedValue === 'object'
      ? JSON.stringify(mergedValue)
      : mergedValue;

    if (existingJson !== mergedJson) {
      return true;
    }
  }

  return false;
}

function resolveVariants(
  existingVariants,
  incomingVariants,
  existingSource,
  incomingSource
) {
  const mergedVariants = Array.isArray(existingVariants)
    ? existingVariants.map((variant) => ({ ...variant }))
    : [];
  const incomingList = Array.isArray(incomingVariants) ? incomingVariants : [];

  const indexByKey = new Map();
  mergedVariants.forEach((variant, index) => {
    const key = getVariantKey(variant);
    if (key && !indexByKey.has(key)) {
      indexByKey.set(key, index);
    }
  });

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const incomingVariant of incomingList) {
    const key = getVariantKey(incomingVariant);
    if (!key) {
      mergedVariants.push({ ...incomingVariant });
      added += 1;
      continue;
    }

    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      mergedVariants.push({ ...incomingVariant });
      indexByKey.set(key, mergedVariants.length - 1);
      added += 1;
      continue;
    }

    const existingVariant = mergedVariants[existingIndex];
    const winner = higherPrioritySource(existingSource, incomingSource);
    const primary = winner === 'a' ? existingVariant : incomingVariant;
    const secondary = winner === 'a' ? incomingVariant : existingVariant;

    const merged = { ...primary };

    if (!Number.isFinite(merged.price) && Number.isFinite(secondary?.price)) {
      merged.price = secondary.price;
    }

    if (isEmptyValue(merged.availability) && !isEmptyValue(secondary?.availability)) {
      merged.availability = secondary.availability;
    }

    Object.keys(secondary || {}).forEach((field) => {
      if (merged[field] === undefined || merged[field] === null || merged[field] === '') {
        merged[field] = secondary[field];
      }
    });

    if (merged.sku === undefined || merged.sku === null || merged.sku === '') {
      merged.sku = secondary?.sku ?? merged.sku;
    }

    if (merged.variantId === undefined || merged.variantId === null || merged.variantId === '') {
      merged.variantId = secondary?.variantId ?? merged.variantId;
    }

    if (hasVariantChanged(existingVariant, merged)) {
      mergedVariants[existingIndex] = merged;
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    mergedVariants,
    added,
    updated,
    skipped
  };
}

async function updateCanonicalWithConflictResolution(
  canonicalProductId,
  incomingProduct
) {
  const emptyResult = {
    canonicalId: canonicalProductId || null,
    updated: false,
    conflicts: [],
    variantChanges: { mergedVariants: [], added: 0, updated: 0, skipped: 0 }
  };

  try {
    if (!incomingProduct) {
      return emptyResult;
    }

    await connectDB();
    const collection = mongoose.connection.collection('canonical_products');
    let canonical = null;
    let canonicalId = canonicalProductId || null;

    if (canonicalId) {
      canonical = await collection.findOne({ canonicalId });
    }

    if (!canonical) {
      const created = await getOrCreateCanonical(incomingProduct);
      if (!created?.canonical?.canonicalId) {
        logger.warn({
          message: 'Canonical creation failed during conflict resolution',
          service: 'conflict-resolution',
          sourceId: incomingProduct?.sourceId || null
        });
        return emptyResult;
      }

      canonicalId = created.canonical.canonicalId;
      canonical = created.canonical;
    }

    const conflictResolution = resolveConflicts(canonical, incomingProduct);
    const existingSource = getCanonicalSource(canonical);
    const incomingSource = incomingProduct?.source || null;
    const variantChanges = resolveVariants(
      canonical?.variants,
      incomingProduct?.variants,
      existingSource,
      incomingSource
    );

    const resolvedProduct = {
      ...conflictResolution.resolvedProduct,
      canonicalId,
      variants: variantChanges.mergedVariants,
      updatedAt: new Date()
    };

    if (resolvedProduct.priceRange === undefined && canonical?.priceRange) {
      resolvedProduct.priceRange = canonical.priceRange;
    }

    const { _id, ...updateDoc } = resolvedProduct;

    await collection.updateOne(
      { canonicalId },
      { $set: updateDoc },
      { upsert: true }
    );

    if (conflictResolution.conflicts.length > 0) {
      conflictResolution.conflicts.forEach((conflict) => {
        logger.info({
          message: 'Conflict resolved',
          service: 'conflict-resolution',
          canonicalId,
          field: conflict.field,
          winner: conflict.winner,
          reason: conflict.reason,
          existingSource: conflict.existingSource,
          incomingSource: conflict.incomingSource
        });
      });
    }

    return {
      canonicalId,
      updated: true,
      conflicts: conflictResolution.conflicts,
      variantChanges
    };
  } catch (error) {
    logger.error({
      message: 'Conflict resolution update failed',
      service: 'conflict-resolution',
      canonicalId: canonicalProductId || null,
      error: error?.message || String(error)
    });
    return emptyResult;
  }
}

module.exports = {
  SOURCE_PRIORITY,
  getSourcePriority,
  higherPrioritySource,
  resolveField,
  resolveConflicts,
  resolveVariants,
  updateCanonicalWithConflictResolution
};
