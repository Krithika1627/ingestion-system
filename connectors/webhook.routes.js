const express = require('express');
const logger = require('../services/logger.service');
const {
        verifyShopifyHmac,
        verifyWooCommerceSignature,
        checkTimestamp,
        checkDuplicate,
        processShopifyWebhook,
        processWooCommerceWebhook
} = require('../services/webhook.service');

const router = express.Router();

router.post('/shopify/:storeId', express.raw({ type: 'application/json' }), async (req, res) => {
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

        /* Parse body early — needed for checks below */
        let payload;
        try {
                payload = JSON.parse(rawBody.toString('utf-8'));
        } catch (parseError) {
                logger.error({
                        message: 'Shopify webhook body parse error',
                        platform: 'shopify',
                        storeId,
                        topic,
                        error: parseError?.message || String(parseError)
                });
                return res.status(200).json({ success: true, message: 'Webhook received — unparseable body' });
        }

        /* Duplicate check */
        const webhookId = req.headers['x-shopify-webhook-id'];
        const { isDuplicate } = await checkDuplicate(webhookId, 'shopify', topic, storeId);
        if (isDuplicate) {
                logger.info({
                        message: 'Shopify webhook duplicate skipped',
                        webhookId,
                        storeId,
                        topic
                });
                return res.status(200).json({ success: true, message: 'duplicate skipped' });
        }

        /* Timestamp check */
        const { valid, reason } = checkTimestamp(payload);
        if (!valid) {
                logger.warn({
                        message: 'Shopify webhook timestamp rejected',
                        reason,
                        storeId,
                        topic
                });
                return res.status(200).json({ success: true, message: 'rejected: ' + reason });
        }

        /* Respond 200 immediately — Shopify retries if no 200 within 5 s */
        res.status(200).json({ success: true, message: 'Webhook received' });

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
});

router.post('/woocommerce/:storeId', express.raw({ type: 'application/json' }), async (req, res) => {
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

        /* Duplicate check only (no timestamp check for WooCommerce) */
        const webhookId = req.headers['x-wc-webhook-id'];
        const { isDuplicate } = await checkDuplicate(webhookId, 'woocommerce', topic, storeId);
        if (isDuplicate) {
                logger.info({
                        message: 'WooCommerce webhook duplicate skipped',
                        webhookId,
                        storeId,
                        topic
                });
                return res.status(200).json({ success: true, message: 'duplicate skipped' });
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

router.get('/health', (_req, res) => {
        res.json({
                status: 'ok',
                timestamp: new Date().toISOString()
        });
});

module.exports = router;