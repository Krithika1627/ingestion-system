const crypto = require('crypto');
const mongoose = require('mongoose');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { randomUUID } = require('crypto');

const logger = require('./logger.service');
const { WebhookEvent } = require('../models/webhook_event.model');
const { invalidate } = require('./cache.service');
const { connectDB, upsertProduct, upsertRaw, upsertOffer, updateOfferInventory } = require('./db.service');
const { transformProduct: transformShopifyProduct } = require('../transformers/shopify.transformer');
const { transformProduct: transformWooProduct } = require('../transformers/woocommerce.transformer');
const {
        buildGroupingKey,
        findExistingProductMatch,
        mergeMatchedProduct
} = require('./product-matching.service');
const {
        getOrCreateCanonical,
        mapSourceToCanonical
} = require('./canonical/canonical.service');
const {
        syncCanonicalPriceRange
} = require('./offer-aggregation/offer.aggregation.service');
const {
        updateCanonicalWithConflictResolution
} = require('./conflict-resolution/conflict.service');

const productSchema = require('../schemas/product.schema.json');

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validate = ajv.compile(productSchema);

function verifyShopifyHmac(rawBody, hmacHeader) {
        if (!rawBody || !hmacHeader) {
                logger.warn({
                        message: 'Shopify HMAC verification skipped — missing rawBody or header',
                        service: 'webhook'
                });
                return false;
        }

        const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
        if (!secret) {
                logger.error({
                        message: 'SHOPIFY_WEBHOOK_SECRET is not configured',
                        service: 'webhook'
                });
                return false;
        }

        try {
                const computed = crypto
                        .createHmac('sha256', secret)
                        .update(rawBody)
                        .digest('base64');

                const computedBuf = Buffer.from(computed, 'base64');
                const headerBuf = Buffer.from(hmacHeader, 'base64');

                if (computedBuf.length !== headerBuf.length) {
                        return false;
                }

                return crypto.timingSafeEqual(computedBuf, headerBuf);
        } catch (error) {
                logger.error({
                        message: 'Shopify HMAC verification error',
                        service: 'webhook',
                        error: error?.message || String(error)
                });
                return false;
        }
}

function verifyWooCommerceSignature(rawBody, signatureHeader) {
        if (!rawBody || !signatureHeader) {
                logger.warn({
                        message: 'WooCommerce signature verification skipped — missing rawBody or header',
                        service: 'webhook'
                });
                return false;
        }

        const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET;
        if (!secret) {
                logger.error({
                        message: 'WOOCOMMERCE_WEBHOOK_SECRET is not configured',
                        service: 'webhook'
                });
                return false;
        }

        try {
                const computed = crypto
                        .createHmac('sha256', secret)
                        .update(rawBody)
                        .digest('base64');

                const computedBuf = Buffer.from(computed, 'base64');
                const headerBuf = Buffer.from(signatureHeader, 'base64');

                if (computedBuf.length !== headerBuf.length) {
                        return false;
                }

                return crypto.timingSafeEqual(computedBuf, headerBuf);
        } catch (error) {
                logger.error({
                        message: 'WooCommerce signature verification error',
                        service: 'webhook',
                        error: error?.message || String(error)
                });
                return false;
        }
}

function adaptShopifyRestToGraphql(restPayload) {
        const src = restPayload || {};

        const variantNodes = (Array.isArray(src.variants) ? src.variants : []).map((v) => ({
                id: v?.id != null
        ? (String(v.id).startsWith('gid://') ? String(v.id) : `gid://shopify/ProductVariant/${v.id}`)
        : null,
                sku: v?.sku || null,
                price: v?.price != null ? String(v.price) : null,
                compareAtPrice: v?.compare_at_price != null ? String(v.compare_at_price) : null,
                inventoryQuantity: typeof v?.inventory_quantity === 'number' ? v.inventory_quantity : null,
                inventoryItemId: v?.inventory_item_id != null ? v?.inventory_item_id : null
        }));

        const mediaEdges = (Array.isArray(src.images) ? src.images : []).map((img, idx) => ({
                node: {
                        preview: {
                                image: {
                                        url: img?.src || null
                                }
                        }
                }
        }));

        const tags = Array.isArray(src.tags)
                ? src.tags
                : typeof src.tags === 'string'
                        ? src.tags.split(',').map((t) => t.trim()).filter(Boolean)
                        : [];

        const currencyCode = src?.variants?.[0]?.presentment_prices?.[0]?.price?.currency_code || 'INR';

        return {
                id: src?.id != null
        ? (String(src.id).startsWith('gid://') ? String(src.id) : `gid://shopify/Product/${src.id}`)
        : null,
                title: src?.title || '',
                description: src?.body_html || null,
                vendor: src?.vendor || null,
                productType: src?.product_type || null,
                status: src?.status || null,
                tags,
                createdAt: src?.created_at || null,
                updatedAt: src?.updated_at || null,
                variants: {
                        edges: variantNodes.map((node) => ({ node }))
                },
                media: {
                        edges: mediaEdges
                },
                priceRangeV2: {
                        minVariantPrice: {
                                currencyCode
                        }
                }
        };
}

function getAvailability(inventoryQty, isInStock) {
        if (typeof inventoryQty !== 'number') {
                return isInStock ? 'in_stock' : 'out_of_stock';
        }
        return inventoryQty > 0 ? 'in_stock' : 'out_of_stock';
}

function buildOfferFromVariant(product, variant) {
        return {
                id: randomUUID(),
                sourceId: product?.sourceId || null,
                productId: product?.id || null,
                storeId: product?.storeId || null,
                variantId: variant?.variantId || null,
                sku: variant?.sku ?? product?.sku ?? null,
                price: variant?.price ?? null,
                compareAtPrice: variant?.compareAtPrice ?? null,
                currency: variant?.currency ?? null,
                stockQty: variant?.inventoryQty ?? null,
                isInStock: variant?.isInStock ?? false,
                availability: getAvailability(variant?.inventoryQty, variant?.isInStock ?? false),
                lastSyncedAt: product?.lastSyncedAt || new Date().toISOString()
        };
}

async function processSingleShopifyProduct(rawProduct, storeId) {
        const pipelineStoreId = storeId || 'store_shopify_001';

        try {
                await connectDB();

                const graphqlNode = adaptShopifyRestToGraphql(rawProduct);

                const rawPayload = {
                        storeId: pipelineStoreId,
                        sourceId: graphqlNode?.id || rawProduct?.id || null,
                        data: rawProduct
                };
                await upsertRaw('shopify', rawPayload);

                let canonicalProduct = transformShopifyProduct(graphqlNode, pipelineStoreId);
                canonicalProduct.groupingKey = buildGroupingKey(canonicalProduct);

                const isValid = validate(canonicalProduct);
                if (!isValid) {
                        logger.warn({
                                message: 'Shopify webhook product validation failed',
                                platform: 'shopify',
                                storeId: pipelineStoreId,
                                sourceId: canonicalProduct?.sourceId || null,
                                errors: validate.errors
                        });
                        return { success: false, sourceId: canonicalProduct?.sourceId || null, error: 'Validation failed' };
                }

                const matchResult = await findExistingProductMatch(pipelineStoreId, canonicalProduct);
                if (matchResult?.match) {
                        canonicalProduct = mergeMatchedProduct(matchResult.match, canonicalProduct);
                }

                const canonicalResult = await getOrCreateCanonical(canonicalProduct);
                if (canonicalResult?.canonical?.canonicalId) {
                        canonicalProduct.canonicalProductId = canonicalResult.canonical.canonicalId;
                }

                await upsertProduct(canonicalProduct);

                const variants = Array.isArray(canonicalProduct?.variants) ? canonicalProduct.variants : [];
                if (variants.length > 0) {
                        const offerTasks = variants.map((variant) => {
                                const offerRecord = buildOfferFromVariant(canonicalProduct, variant);
                                return upsertOffer(offerRecord);
                        });
                        await Promise.allSettled(offerTasks);
                }

                if (canonicalResult?.canonical?.canonicalId) {
                        await mapSourceToCanonical(canonicalProduct, canonicalResult.canonical.canonicalId);
                        await updateCanonicalWithConflictResolution(canonicalResult.canonical.canonicalId, canonicalProduct);
                }

                if (canonicalProduct?.canonicalProductId) {
                        try {
                                await syncCanonicalPriceRange(canonicalProduct.canonicalProductId);
                        } catch (priceError) {
                                logger.warn({
                                        message: 'Shopify webhook canonical price range sync failed',
                                        platform: 'shopify',
                                        storeId: pipelineStoreId,
                                        canonicalProductId: canonicalProduct.canonicalProductId,
                                        error: priceError?.message || String(priceError)
                                });
                        }

                        invalidate('/products/' + canonicalProduct.canonicalProductId);
                        invalidate('/ai/products/' + canonicalProduct.canonicalProductId);
                }

                return { success: true, sourceId: canonicalProduct?.sourceId || null };
        } catch (error) {
                logger.error({
                        message: 'Shopify webhook single-product processing error',
                        platform: 'shopify',
                        storeId: pipelineStoreId,
                        sourceId: rawProduct?.id || null,
                        error: error?.message || String(error),
                        stack: error?.stack || null
                });
                return { success: false, sourceId: rawProduct?.id || null, error: error?.message || String(error) };
        }
}

async function processSingleWooProduct(rawProduct, storeId) {
        const pipelineStoreId = storeId || 'store_woo_001';

        try {
                await connectDB();

                const sourceId = rawProduct?.id != null ? String(rawProduct.id) : null;

                const rawPayload = {
                        storeId: pipelineStoreId,
                        sourceId,
                        data: rawProduct
                };
                await upsertRaw('woocommerce', rawPayload);
                
                let canonicalProduct = transformWooProduct(rawProduct, pipelineStoreId);
                canonicalProduct.groupingKey = buildGroupingKey(canonicalProduct);

                if (!canonicalProduct.status || typeof canonicalProduct.status !== 'string') {
                canonicalProduct.status = rawProduct?.status === 'draft' ? 'draft' : 'active';
                }

                const isValid = validate(canonicalProduct);
                if (!isValid) {
                        logger.warn({
                                message: 'WooCommerce webhook product validation failed',
                                platform: 'woocommerce',
                                storeId: pipelineStoreId,
                                sourceId: canonicalProduct?.sourceId || null,
                                errors: validate.errors
                        });
                        return { success: false, sourceId: canonicalProduct?.sourceId || null, error: 'Validation failed' };
                }

                const matchResult = await findExistingProductMatch(pipelineStoreId, canonicalProduct);
                if (matchResult?.match) {
                        canonicalProduct = mergeMatchedProduct(matchResult.match, canonicalProduct);
                }

                const canonicalResult = await getOrCreateCanonical(canonicalProduct);
                if (canonicalResult?.canonical?.canonicalId) {
                        canonicalProduct.canonicalProductId = canonicalResult.canonical.canonicalId;
                }

                await upsertProduct(canonicalProduct);

                const parseNumber = (v) => { const p = parseFloat(v); return Number.isFinite(p) ? p : null; };
                const price = parseNumber(rawProduct?.price);
                const regularPrice = parseNumber(rawProduct?.regular_price);
                const salePrice = parseNumber(rawProduct?.sale_price);
                const onSale = Boolean(rawProduct?.on_sale);
                const discountPercent =
                        onSale && Number.isFinite(regularPrice) && Number.isFinite(salePrice) && regularPrice
                                ? Number((((regularPrice - salePrice) / regularPrice) * 100).toFixed(2))
                                : null;

                const offerRecord = {
                        id: randomUUID(),
                        sourceId,
                        productId: canonicalProduct?.id || null,
                        storeId: pipelineStoreId,
                        variantId: rawProduct?.sku || sourceId,
                        sku: rawProduct?.sku || null,
                        price: Number.isFinite(price) ? price : 0,
                        compareAtPrice: onSale && Number.isFinite(regularPrice) ? regularPrice : null,
                        discountPercent,
                        currency: 'INR',
                        availability: rawProduct?.stock_status === 'outofstock' ? 'out_of_stock' : 'in_stock',
                        stockQty: rawProduct?.stock_quantity ?? null,
                        lastSyncedAt: new Date().toISOString()
                };

                await upsertOffer(offerRecord);

                if (canonicalResult?.canonical?.canonicalId) {
                        await mapSourceToCanonical(canonicalProduct, canonicalResult.canonical.canonicalId);
                        await updateCanonicalWithConflictResolution(canonicalResult.canonical.canonicalId, canonicalProduct);
                }

                if (canonicalProduct?.canonicalProductId) {
                        try {
                                await syncCanonicalPriceRange(canonicalProduct.canonicalProductId);
                        } catch (priceError) {
                                logger.warn({
                                        message: 'WooCommerce webhook canonical price range sync failed',
                                        platform: 'woocommerce',
                                        storeId: pipelineStoreId,
                                        canonicalProductId: canonicalProduct.canonicalProductId,
                                        error: priceError?.message || String(priceError)
                                });
                        }

                        /* Invalidate caches for the updated product */
                        invalidate('/products/' + canonicalProduct.canonicalProductId);
                        invalidate('/ai/products/' + canonicalProduct.canonicalProductId);
                }

                return { success: true, sourceId };
        } catch (error) {
                logger.error({
                        message: 'WooCommerce webhook single-product processing error',
                        platform: 'woocommerce',
                        storeId: pipelineStoreId,
                        sourceId: rawProduct?.id || null,
                        error: error?.message || String(error)
                });
                return { success: false, sourceId: rawProduct?.id || null, error: error?.message || String(error) };
        }
}

async function handleInventoryLevelUpdate(payload, storeId) {
        const pipelineStoreId = storeId || 'store_shopify_001';
        const inventoryItemId = payload?.inventory_item_id;
        const available = typeof payload?.available === 'number' ? payload.available : null;

        if (!inventoryItemId) {
                logger.warn({
                        message: 'Shopify inventory webhook missing inventory_item_id',
                        platform: 'shopify',
                        storeId: pipelineStoreId
                });
                return { success: false, error: 'Missing inventory_item_id' };
        }

        try {
                await connectDB();

                const rawCollection = mongoose.connection.collection('raw_responses');
                const rawDoc = await rawCollection.findOne({
                        platform: 'shopify',
                        storeId: pipelineStoreId,
                        'data.variants.inventory_item_id': inventoryItemId
                });

                let sku = null;

                if (rawDoc?.data?.variants) {
                        const matchingVariant = Array.isArray(rawDoc.data.variants)
                                ? rawDoc.data.variants.find((v) => v?.inventory_item_id === inventoryItemId)
                                : null;
                        sku = matchingVariant?.sku || null;
                }

                if (!sku) {
                        const productsCollection = mongoose.connection.collection('products');
                        const product = await productsCollection.findOne({
                                source: 'shopify',
                                storeId: pipelineStoreId,
                                'variants.inventoryItemId': inventoryItemId
                        });

                        if (product?.variants) {
                                const variant = product.variants.find(
                                        (v) => v?.inventoryItemId === inventoryItemId
                                );
                                sku = variant?.sku || null;
                        }
                }

                if (!sku) {
                        logger.warn({
                                message: 'Shopify inventory webhook — could not resolve SKU for inventory_item_id',
                                platform: 'shopify',
                                storeId: pipelineStoreId,
                                inventoryItemId,
                                available
                        });
                        return { success: false, error: 'SKU not found for inventory_item_id' };
                }

                const isInStock = available === null ? true : available > 0;
                const inventoryPatch = {
                        availability: isInStock ? 'in_stock' : 'out_of_stock',
                        stockQty: available,
                        isInStock,
                        availableInventory: available,
                        lastSyncedAt: new Date().toISOString(),
                        inventorySource: 'shopify_webhook'
                };

                const result = await updateOfferInventory(sku, inventoryPatch, pipelineStoreId);

                logger.info({
                        message: 'Shopify inventory webhook processed',
                        platform: 'shopify',
                        storeId: pipelineStoreId,
                        inventoryItemId,
                        sku,
                        available,
                        offersMatched: result?.offersMatched || 0,
                        offersModified: result?.offersModified || 0
                });

                return { success: true };
        } catch (error) {
                logger.error({
                        message: 'Shopify inventory webhook processing error',
                        platform: 'shopify',
                        storeId: pipelineStoreId,
                        inventoryItemId,
                        error: error?.message || String(error)
                });
                return { success: false, error: error?.message || String(error) };
        }
}

async function markProductInactive(platform, sourceId, storeId) {
        if (!platform || !sourceId || !storeId) {
                logger.warn({
                        message: 'markProductInactive called with missing arguments',
                        service: 'webhook',
                        platform: platform || null,
                        sourceId: sourceId || null,
                        storeId: storeId || null
                });
                return { success: false, error: 'Missing required arguments' };
        }

        try {
                await connectDB();

                const productsCollection = mongoose.connection.collection('products');

                const result = await productsCollection.updateOne(
                        { sourceId, source: platform, storeId },
                        {
                                $set: {
                                        status: 'inactive',
                                        updatedAt: new Date().toISOString(),
                                        lastSyncedAt: new Date().toISOString()
                                }
                        }
                );

                if (result.matchedCount === 0) {
                        logger.warn({
                                message: 'Product not found for deactivation',
                                platform,
                                storeId,
                                sourceId
                        });
                        return { success: false, error: 'Product not found' };
                }

                /* Also mark related offers as out_of_stock */
                const offersCollection = mongoose.connection.collection('offers');
                const offersResult = await offersCollection.updateMany(
                    { sourceId, storeId },
                    {
                        $set: {
                            availability: 'out_of_stock',
                            isInStock: false,
                            lastSyncedAt: new Date().toISOString()
                        }
                    }
                );

                logger.info({
                        message: 'Product marked inactive via webhook',
                        platform,
                        storeId,
                        sourceId,
                        productsMatched: result.matchedCount,
                        offersUpdated: offersResult.modifiedCount
                });

                return { success: true };
        } catch (error) {
                logger.error({
                        message: 'Failed to mark product inactive',
                        platform,
                        storeId,
                        sourceId,
                        error: error?.message || String(error)
                });
                return { success: false, error: error?.message || String(error) };
        }
}

async function processShopifyWebhook(topic, payload, storeId) {
        const pipelineStoreId = storeId || 'store_shopify_001';

        logger.info({
                message: 'Shopify webhook received',
                platform: 'shopify',
                topic,
                storeId: pipelineStoreId,
                sourceId: payload?.id || null
        });

        let result;

        try {
                switch (topic) {
                        case 'products/create':
                        case 'products/update':
                                result = await processSingleShopifyProduct(payload, pipelineStoreId);
                                break;

                        case 'products/delete':
                            result = await markProductInactive(
                                'shopify',
                                payload?.id != null
                                    ? (String(payload.id).startsWith('gid://')
                                        ? String(payload.id)
                                        : `gid://shopify/Product/${payload.id}`)
                                    : null,
                                pipelineStoreId
                            );
                            break;

                        case 'inventory_levels/update':
                                result = await handleInventoryLevelUpdate(payload, pipelineStoreId);
                                break;

                        default:
                                logger.info({
                                        message: 'Unhandled Shopify webhook topic — skipping',
                                        platform: 'shopify',
                                        topic,
                                        storeId: pipelineStoreId
                                });
                                result = { success: true, skipped: true, reason: `Unhandled topic: ${topic}` };
                }
        } catch (error) {
                logger.error({
                        message: 'Shopify webhook processing error',
                        platform: 'shopify',
                        topic,
                        storeId: pipelineStoreId,
                        error: error?.message || String(error)
                });
                result = { success: false, error: error?.message || String(error) };
        }

        logger.info({
                message: 'Shopify webhook processing complete',
                platform: 'shopify',
                topic,
                storeId: pipelineStoreId,
                outcome: result?.success ? 'success' : 'failed',
                error: result?.error || null
        });

        return { ...result, topic };
}

async function processWooCommerceWebhook(topic, payload, storeId) {
        const pipelineStoreId = storeId || 'store_woo_001';

        logger.info({
                message: 'WooCommerce webhook received',
                platform: 'woocommerce',
                topic,
                storeId: pipelineStoreId,
                sourceId: payload?.id || null
        });

        let result;

        try {
                switch (topic) {
                        case 'product.created':
                        case 'product.updated':
                                result = await processSingleWooProduct(payload, pipelineStoreId);
                                break;

                        case 'product.deleted':
                                result = await markProductInactive(
                                        'woocommerce',
                                        payload?.id != null ? String(payload.id) : null,
                                        pipelineStoreId
                                );
                                break;

                        default:
                                logger.info({
                                        message: 'Unhandled WooCommerce webhook topic — skipping',
                                        platform: 'woocommerce',
                                        topic,
                                        storeId: pipelineStoreId
                                });
                                result = { success: true, skipped: true, reason: `Unhandled topic: ${topic}` };
                }
        } catch (error) {
                logger.error({
                        message: 'WooCommerce webhook processing error',
                        platform: 'woocommerce',
                        topic,
                        storeId: pipelineStoreId,
                        error: error?.message || String(error)
                });
                result = { success: false, error: error?.message || String(error) };
        }

        logger.info({
                message: 'WooCommerce webhook processing complete',
                platform: 'woocommerce',
                topic,
                storeId: pipelineStoreId,
                outcome: result?.success ? 'success' : 'failed',
                error: result?.error || null
        });

        return { ...result, topic };
}

/**
 * Check if a webhook payload's timestamp is within the acceptable window.
 *
 * @param {Object} payload — Parsed webhook body
 * @returns {{ valid: boolean, reason?: string }}
 */
function checkTimestamp(payload) {
        if (payload && typeof payload.created_at === 'string') {
                const createdAt = new Date(payload.created_at);
                if (Number.isNaN(createdAt.getTime())) {
                        logger.warn({
                                message: 'Shopify webhook — unparseable created_at',
                                platform: 'shopify',
                                created_at: payload.created_at
                        });
                        return { valid: true };
                }

                const now = Date.now();
                const fiveMinutesMs = 5 * 60 * 1000;
                const age = now - createdAt.getTime();

                if (age > fiveMinutesMs) {
                        return { valid: false, reason: 'Webhook too old' };
                }

                if (age < -30 * 1000) {
                        return { valid: false, reason: 'Webhook timestamp in the future' };
                }
        }
        return { valid: true };
}

async function checkDuplicate(webhookId, platform, topic, storeId) {
        if (webhookId == null) {
                return { isDuplicate: false };
        }

        try {
                const existing = await WebhookEvent.findOne({ webhookId, platform, topic, storeId }).lean();

                if (existing) {
                        return { isDuplicate: true };
                }

                await WebhookEvent.create({
                        webhookId,
                        platform,
                        topic,
                        storeId
                });

                return { isDuplicate: false };
        } catch (error) {
                if (error?.code === 11000) {
                        logger.warn({
                                message: 'Webhook duplicate race condition caught',
                                platform,
                                webhookId,
                                error: error?.message || String(error)
                        });
                        return { isDuplicate: true };
                }

                logger.error({
                        message: 'Webhook duplicate check error',
                        platform,
                        webhookId,
                        error: error?.message || String(error)
                });
                return { isDuplicate: false };
        }
}

module.exports = {
        verifyShopifyHmac,
        verifyWooCommerceSignature,
        checkTimestamp,
        checkDuplicate,
        processShopifyWebhook,
        processWooCommerceWebhook,
        adaptShopifyRestToGraphql,
        markProductInactive,
        handleInventoryLevelUpdate
};