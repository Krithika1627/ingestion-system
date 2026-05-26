const crypto = require('crypto');
const mongoose = require('mongoose');
const logger = require('../logger.service');
const { connectDB } = require('../db.service');
const { normalizeText, normalizeBrand } = require('../deduplication/dedup.service');

const CanonicalProductSchema = new mongoose.Schema(
  {
    canonicalId: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    cleanedTitle: { type: String },
    brand: { type: String, default: null },
    normalizedBrand: { type: String, default: null },
    category: { type: String, default: null },
    attributes: { type: Object, default: {} },
    images: { type: Array, default: [] },
    variants: { type: Array, default: [] },
    priceRange: {
      min: { type: Number, default: null },
      max: { type: Number, default: null },
      currency: { type: String, default: null }
    },
    sourceCount: { type: Number, default: 0 },
    sources: { type: Array, default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'canonical_products', versionKey: false }
);

const CanonicalProduct =
  mongoose.models.CanonicalProduct ||
  mongoose.model('CanonicalProduct', CanonicalProductSchema);

function generateCanonicalId(product) {
  const title = normalizeText(product?.cleanedTitle || product?.title || '');
  if (!title) {
    return null;
  }

  const brand = normalizeBrand(product?.brand || '') || '';
  const input = `${title}|${brand}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return `cprod_${hash.slice(0, 24)}`;
}

function computePriceRangeFromVariants(variants) {
  const prices = Array.isArray(variants)
    ? variants
        .map((variant) => variant?.price)
        .filter((price) => Number.isFinite(price))
    : [];

  if (prices.length === 0) {
    return { min: null, max: null, currency: null };
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const currency = variants?.find((variant) => variant?.currency)?.currency || null;
  return { min, max, currency };
}

function mergeImages(existing, incoming) {
  const seen = new Set();
  const merged = [];
  const addImage = (image) => {
    const url = image?.url || image;
    if (!url) {
      return;
    }
    const key = String(url).trim();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(image);
  };

  (Array.isArray(existing) ? existing : []).forEach(addImage);
  (Array.isArray(incoming) ? incoming : []).forEach(addImage);
  return merged;
}

function mergeVariants(existing, incoming) {
  const merged = [];
  const seen = new Set();

  const addVariant = (variant) => {
    if (!variant) {
      return;
    }
    const key = variant?.variantId || variant?.sku || JSON.stringify(variant);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(variant);
  };

  (Array.isArray(existing) ? existing : []).forEach(addVariant);
  (Array.isArray(incoming) ? incoming : []).forEach(addVariant);
  return merged;
}

function mergeAttributes(existing, incoming) {
  const output = { ...(existing || {}) };
  if (!incoming || typeof incoming !== 'object') {
    return output;
  }

  Object.entries(incoming).forEach(([key, value]) => {
    if (output[key] === undefined || output[key] === null || output[key] === '') {
      output[key] = value;
    }
  });

  return output;
}

function mergePriceRange(existing, incoming) {
  const min = Number.isFinite(incoming?.min)
    ? Math.min(
        Number.isFinite(existing?.min) ? existing.min : incoming.min,
        incoming.min
      )
    : existing?.min ?? null;
  const max = Number.isFinite(incoming?.max)
    ? Math.max(
        Number.isFinite(existing?.max) ? existing.max : incoming.max,
        incoming.max
      )
    : existing?.max ?? null;
  const currency = existing?.currency || incoming?.currency || null;

  return { min, max, currency };
}

async function getCanonicalById(canonicalId) {
  try {
    await connectDB();
    return await CanonicalProduct.findOne({ canonicalId }).lean();
  } catch (error) {
    logger.error({
      message: 'Canonical lookup failed',
      service: 'canonical',
      canonicalId,
      error: error?.message || String(error)
    });
    return null;
  }
}

async function getOrCreateCanonical(product) {
  try {
    await connectDB();

    const canonicalId = generateCanonicalId(product);
    if (!canonicalId) {
      return { canonical: null, created: false };
    }

    const existing = await CanonicalProduct.findOne({ canonicalId }).lean();
    if (existing) {
      return { canonical: existing, created: false };
    }

    const priceRange = computePriceRangeFromVariants(product?.variants || []);
    const canonicalDoc = {
      canonicalId,
      title: product?.title || '',
      cleanedTitle: product?.cleanedTitle || product?.title || '',
      brand: product?.brand || null,
      normalizedBrand: product?.normalizedBrand || null,
      category: product?.category || null,
      attributes: product?.attributes || {},
      images: Array.isArray(product?.images) ? product.images : [],
      variants: Array.isArray(product?.variants) ? product.variants : [],
      priceRange,
      sourceCount: 1,
      sources: product?.source ? [product.source] : [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const created = await CanonicalProduct.create(canonicalDoc);
    return { canonical: created.toObject(), created: true };
  } catch (error) {
    logger.error({
      message: 'Canonical create failed',
      service: 'canonical',
      error: error?.message || String(error)
    });
    return { canonical: null, created: false };
  }
}

async function mapSourceToCanonical(sourceProduct, canonicalId) {
  const timestamp = new Date().toISOString();

  try {
    if (!sourceProduct?.sourceId || !canonicalId) {
      return { success: false, canonicalId: canonicalId || null };
    }

    await connectDB();
    const productsCollection = mongoose.connection.collection('products');

    const sourceIdCandidates = new Set();
    const rawSourceId = sourceProduct?.sourceId;
    if (rawSourceId !== undefined && rawSourceId !== null) {
      sourceIdCandidates.add(rawSourceId);
      if (typeof rawSourceId === 'string') {
        const asNumber = Number(rawSourceId);
        if (Number.isFinite(asNumber)) {
          sourceIdCandidates.add(asNumber);
        }
      } else if (typeof rawSourceId === 'number') {
        sourceIdCandidates.add(String(rawSourceId));
      }
    }

    const sourceIdList = Array.from(sourceIdCandidates);
    const sourceIdFilter = sourceIdList.length > 1
      ? { $in: sourceIdList }
      : sourceIdList[0];

    const productFilter = sourceProduct?.storeId
      ? { sourceId: sourceIdFilter, storeId: sourceProduct.storeId }
      : { sourceId: sourceIdFilter };

    logger.info({
      message: 'Canonical mapping update attempt',
      service: 'canonical',
      sourceId: sourceProduct?.sourceId || null,
      sourceIdCandidates: sourceIdList,
      storeId: sourceProduct?.storeId || null,
      source: sourceProduct?.source || null,
      canonicalId
    });

    const updateResult = await productsCollection.updateOne(
      productFilter,
      {
        $set: {
          canonicalProductId: canonicalId,
          canonicalMappedAt: new Date()
        }
      }
    );

    logger.info({
      message: 'Canonical mapping update result',
      service: 'canonical',
      sourceId: sourceProduct?.sourceId || null,
      canonicalId,
      matchedCount: updateResult?.matchedCount ?? null,
      modifiedCount: updateResult?.modifiedCount ?? null
    });

    if ((updateResult?.matchedCount || 0) === 0 && sourceProduct?.id) {
      const fallbackResult = await productsCollection.updateOne(
        { id: sourceProduct.id },
        {
          $set: {
            canonicalProductId: canonicalId,
            canonicalMappedAt: new Date()
          }
        }
      );

      logger.warn({
        message: 'Canonical mapping fallback update result',
        service: 'canonical',
        sourceId: sourceProduct?.sourceId || null,
        productId: sourceProduct?.id || null,
        canonicalId,
        matchedCount: fallbackResult?.matchedCount ?? null,
        modifiedCount: fallbackResult?.modifiedCount ?? null
      });
    }

    const canonical = await CanonicalProduct.findOne({ canonicalId });
    if (!canonical) {
      return { success: false, canonicalId };
    }

    const existingSources = Array.isArray(canonical.sources) ? canonical.sources : [];
    const nextSources = new Set(existingSources);
    if (sourceProduct?.source) {
      nextSources.add(sourceProduct.source);
    }

    const sourceCount = nextSources.size;
    const nextPriceRange = mergePriceRange(
      canonical.priceRange || {},
      computePriceRangeFromVariants(sourceProduct?.variants || [])
    );
    const nextVariants = mergeVariants(canonical.variants || [], sourceProduct?.variants || []);
    const nextImages = mergeImages(canonical.images || [], sourceProduct?.images || []);
    const nextAttributes = mergeAttributes(canonical.attributes || {}, sourceProduct?.attributes || {});

    canonical.title = canonical.title || sourceProduct?.title || canonical.title;
    canonical.cleanedTitle = canonical.cleanedTitle || sourceProduct?.cleanedTitle || canonical.cleanedTitle;
    canonical.brand = canonical.brand || sourceProduct?.brand || canonical.brand;
    canonical.normalizedBrand = canonical.normalizedBrand || sourceProduct?.normalizedBrand || canonical.normalizedBrand;
    canonical.category = canonical.category || sourceProduct?.category || canonical.category;
    canonical.attributes = nextAttributes;
    canonical.images = nextImages;
    canonical.variants = nextVariants;
    canonical.priceRange = nextPriceRange;
    canonical.sources = Array.from(nextSources);
    canonical.sourceCount = sourceCount;
    canonical.updatedAt = new Date();

    await canonical.save();

    logger.info({
      sourceId: sourceProduct?.sourceId || null,
      source: sourceProduct?.source || null,
      canonicalId,
      timestamp
    });

    return { success: true, canonicalId };
  } catch (error) {
    logger.error({
      message: 'Canonical mapping failed',
      service: 'canonical',
      error: error?.message || String(error)
    });
    return { success: false, canonicalId: canonicalId || null };
  }
}

async function backfillCanonicalIds(options = {}) {
  const start = Date.now();
  const sourceFilter = options?.source || null;
  const batchSize = Number.isFinite(options?.batchSize) ? options.batchSize : 50;
  const dryRun = Boolean(options?.dryRun);

  await connectDB();
  const productsCollection = mongoose.connection.collection('products');

  const baseFilter = {
    $or: [
      { canonicalProductId: { $exists: false } },
      { canonicalProductId: null }
    ]
  };
  const filter = sourceFilter ? { ...baseFilter, source: sourceFilter } : baseFilter;

  const total = await productsCollection.countDocuments(filter);
  const cursor = productsCollection.find(filter).batchSize(batchSize);

  let mapped = 0;
  let skipped = 0;
  let failed = 0;
  let newCanonicalProductsCreated = 0;
  let existingCanonicalProductsReused = 0;

  for await (const product of cursor) {
    try {
      const canonicalId = generateCanonicalId(product);
      if (!canonicalId) {
        skipped += 1;
        logger.warn({
          message: 'Canonical ID skipped due to missing title',
          service: 'canonical',
          sourceId: product?.sourceId || null
        });
        continue;
      }

      if (dryRun) {
        const existing = await getCanonicalById(canonicalId);
        if (existing) {
          existingCanonicalProductsReused += 1;
        } else {
          newCanonicalProductsCreated += 1;
        }

        logger.info({
          message: 'Dry run canonical mapping',
          service: 'canonical',
          sourceId: product?.sourceId || null,
          canonicalId
        });
        mapped += 1;
        continue;
      }

      const { canonical, created } = await getOrCreateCanonical(product);
      if (!canonical) {
        skipped += 1;
        continue;
      }

      if (created) {
        newCanonicalProductsCreated += 1;
      } else {
        existingCanonicalProductsReused += 1;
      }

      const mapping = await mapSourceToCanonical(product, canonical.canonicalId);
      if (mapping.success) {
        mapped += 1;
      } else {
        failed += 1;
      }

      if ((mapped + skipped + failed) % 50 === 0) {
        logger.info({
          message: 'Canonical backfill progress',
          service: 'canonical',
          mapped,
          skipped,
          failed,
          totalSoFar: mapped + skipped + failed
        });
      }
    } catch (error) {
      failed += 1;
      logger.error({
        message: 'Canonical backfill failed',
        service: 'canonical',
        error: error?.message || String(error)
      });
    }
  }

  const duration = Number(((Date.now() - start) / 1000).toFixed(2));
  return {
    total,
    mapped,
    skipped,
    failed,
    newCanonicalProductsCreated,
    existingCanonicalProductsReused,
    duration
  };
}

async function getSourcesByCanonicalId(canonicalId) {
  try {
    await connectDB();
    const productsCollection = mongoose.connection.collection('products');
    return await productsCollection.find({ canonicalProductId: canonicalId }).toArray();
  } catch (error) {
    logger.error({
      message: 'Canonical sources lookup failed',
      service: 'canonical',
      canonicalId,
      error: error?.message || String(error)
    });
    return [];
  }
}

async function getCanonicalWithSources(canonicalId) {
  try {
    const canonical = await getCanonicalById(canonicalId);
    if (!canonical) {
      return { canonical: null, sources: [], offers: [] };
    }

    const sources = await getSourcesByCanonicalId(canonicalId);
    const productIds = sources.map((product) => product?.id).filter(Boolean);

    await connectDB();
    const offersCollection = mongoose.connection.collection('offers');
    const offers = productIds.length > 0
      ? await offersCollection.find({ productId: { $in: productIds } }).toArray()
      : [];

    return { canonical, sources, offers };
  } catch (error) {
    logger.error({
      message: 'Canonical lookup with sources failed',
      service: 'canonical',
      canonicalId,
      error: error?.message || String(error)
    });
    return { canonical: null, sources: [], offers: [] };
  }
}

module.exports = {
  generateCanonicalId,
  getOrCreateCanonical,
  mapSourceToCanonical,
  backfillCanonicalIds,
  getCanonicalById,
  getSourcesByCanonicalId,
  getCanonicalWithSources
};
