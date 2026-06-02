/**
 * Webhook routes for Shopify and WooCommerce real-time updates.
 *
 * IMPORTANT: All webhook routes use express.raw({ type: 'application/json' })
 * BEFORE JSON parsing because Shopify HMAC verification requires the raw
 * unparsed body. These routes MUST be registered BEFORE the global
 * express.json() middleware in index.js.
 *
 * All endpoints respond 200 immediately and process the webhook
 * asynchronously — platforms like Shopify retry if no 200 within 5 s.
 */
const express = require('express');
const logger = require('../services/logger.service');
const {
        verifyShopifyHmac,
        verifyWooCommerceSignature,
        processShopifyWebhook,
        processWooCommerceWebhook
} = require('../services/webhook.service');

const router = express.Router();

/* ------------------------------------------------------------------ */
/*  Shopify Webhooks                                                   */
/* ------------------------------------------------------------------ */

/**
 * POST /webhooks/shopify/:storeId
 *
 * Headers:
 *   X-Shopify-Topic       — e.g. 'products/create'
 *   X-Shopify-Hmac-Sha256 — HMAC signature for verification
 *
 * The raw body is captured via express.raw() for HMAC verification,
 * then parsed as JSON for processing.
 */
router.post('/shopify/:storeId', express.raw({ type: 'application/json' }), (req, res) => {
        const storeId = req.params.storeId;
        const topic = req.headers['x-shopify-topic'];
        const hmacHeader = req.headers['x-shopify-hmac-sha256'];
        const rawBody = req.body; // Buffer from express.raw()

        /* Verify HMAC */
        if (!verifyShopifyHmac(rawBody, hmacHeader)) {
                logger.warn({
                        message: 'Shopify webhook HMAC verification failed',
                        platform: 'shopify',
                        storeId,
                        topic
                });
                return res.status(401).json({ success: false, error: 'Invalid HMAC signature' });
        }

        /* Respond 200 immediately — Shopify retries if no 200 within 5 s */
        res.status(200).json({ success: true, message: 'Webhook received' });

        /* Parse body and process asynchronously */
        try {
                const payload = JSON.parse(rawBody.toString('utf-8'));

                /* Fire-and-forget: don't await so we don't block the response */
                processShopifyWebhook(topic, payload, storeId).catch((error) => {
                        logger.error({
                                message: 'Shopify webhook async processing error',
                                platform: 'shopify',
                                storeId,
                                topic,
                                error: error?.message || String(error)
                        });
                });
        } catch (parseError) {
                logger.error({
                        message: 'Shopify webhook body parse error',
                        platform: 'shopify',
                        storeId,
                        topic,
                        error: parseError?.message || String(parseError)
                });
        }
});

/* ------------------------------------------------------------------ */
/*  WooCommerce Webhooks                                               */
/* ------------------------------------------------------------------ */

/**
 * POST /webhooks/woocommerce/:storeId
 *
 * Headers:
 *   X-WC-Webhook-Topic     — e.g. 'product.created'
 *   X-WC-Webhook-Signature — HMAC signature for verification
 */
router.post('/woocommerce/:storeId', express.raw({ type: 'application/json' }), (req, res) => {
        const storeId = req.params.storeId;
        const topic = req.headers['x-wc-webhook-topic'];
        const signatureHeader = req.headers['x-wc-webhook-signature'];
        const rawBody = req.body; // Buffer from express.raw()

        /* Verify signature */
        if (!verifyWooCommerceSignature(rawBody, signatureHeader)) {
                logger.warn({
                        message: 'WooCommerce webhook signature verification failed',
                        platform: 'woocommerce',
                        storeId,
                        topic
                });
                return res.status(401).json({ success: false, error: 'Invalid signature' });
        }

        /* Respond 200 immediately */
        res.status(200).json({ success: true, message: 'Webhook received' });

        /* Parse body and process asynchronously */
        try {
                const payload = JSON.parse(rawBody.toString('utf-8'));

                /* Fire-and-forget */
                processWooCommerceWebhook(topic, payload, storeId).catch((error) => {
                        logger.error({
                                message: 'WooCommerce webhook async processing error',
                                platform: 'woocommerce',
                                storeId,
                                topic,
                                error: error?.message || String(error)
                        });
                });
        } catch (parseError) {
                logger.error({
                        message: 'WooCommerce webhook body parse error',
                        platform: 'woocommerce',
                        storeId,
                        topic,
                        error: parseError?.message || String(parseError)
                });
        }
});

/* ------------------------------------------------------------------ */
/*  Health Check                                                       */
/* ------------------------------------------------------------------ */

/**
 * GET /webhooks/health
 * Returns service health status.
 */
router.get('/health', (_req, res) => {
        res.json({
                status: 'ok',
                timestamp: new Date().toISOString()
        });
});

module.exports = router;