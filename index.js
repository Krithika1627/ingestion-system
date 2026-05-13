/**
 * Express API entry point exposing Shopify sync endpoint.
 */
require('dotenv').config();

const express = require('express');
const logger = require('./services/logger.service');
const { runShopifyFullSync } = require('./pipelines/shopify.pipeline');
const { runShopifyCategoryPipeline, runMagentoCategoryPipeline, runWooCategoryPipeline } = require('./pipelines/category.pipeline');
const { runMagentoFullSync } = require('./pipelines/magento.pipeline');
const { runWooFullSync } = require('./pipelines/woocommerce.pipeline');
const { runUnicommerceInventorySync } = require('./pipelines/unicommerce.pipeline');

const app = express();
app.use(express.json());

app.post('/sync/shopify', async (req, res) => {
	const storeId = req?.body?.storeId || 'store_shopify_001';

	try {
		const summary = await runShopifyFullSync(storeId);
		res.json({ success: true, message: 'Sync complete', summary });
	} catch (error) {
		logger.error({
			message: 'Shopify sync failed',
			platform: 'shopify',
			storeId,
			error: error?.message || String(error)
		});
		res.status(500).json({ success: false, message: error?.message || 'Sync failed' });
	}
});

app.post('/sync/shopify/categories', async (req, res) => {
	const storeId = 'store_shopify_001';

	try {
		const summary = await runShopifyCategoryPipeline(storeId);
		res.json({ success: true, message: 'Category sync complete', summary });
	} catch (error) {
		logger.error({
			message: 'Shopify category sync failed',
			platform: 'shopify',
			storeId,
			error: error?.message || String(error)
		});
		res.status(500).json({
			success: false,
			message: error?.message || 'Category sync failed'
		});
	}
});

app.post('/sync/magento', async (req, res) => {
	try {
		const summary = await runMagentoFullSync('store_magento_001');
		res.json({ success: true, message: 'Magento sync complete', summary });
	} catch (error) {
		logger.error({
			message: 'Magento sync failed',
			platform: 'magento',
			error: error?.message || String(error)
		});
		res.status(500).json({ success: false, error: error?.message || 'Magento sync failed' });
	}
});

app.post('/sync/magento/categories', async (req, res) => {
	try {
		const summary = await runMagentoCategoryPipeline('store_magento_001');
		res.json({ success: true, message: 'Magento category sync complete', summary });
	} catch (error) {
		logger.error({
			message: 'Magento category sync failed',
			platform: 'magento',
			error: error?.message || String(error)
		});
		res.status(500).json({ success: false, error: error?.message || 'Magento category sync failed' });
	}
});

app.post('/sync/woocommerce', async (req, res) => {
	try {
		const storeId = req?.body?.storeId || 'store_woo_001';
		const summary = await runWooFullSync(storeId);
		res.json({ success: true, message: 'WooCommerce sync complete', summary });
	} catch (error) {
		logger.error({
			message: 'WooCommerce sync failed',
			platform: 'woocommerce',
			error: error?.message || String(error)
		});
		res.status(500).json({ success: false, error: error?.message || 'WooCommerce sync failed' });
	}
});

app.post('/sync/woocommerce/categories', async (req, res) => {
	try {
		const summary = await runWooCategoryPipeline('store_woo_001');
		res.json({ success: true, message: 'WooCommerce category sync complete', summary });
	} catch (error) {
		logger.error({
			message: 'WooCommerce category sync failed',
			platform: 'woocommerce',
			error: error?.message || String(error)
		});
		res.status(500).json({ success: false, error: error?.message || 'WooCommerce category sync failed' });
	}
});

app.post('/sync/unicommerce', async (req, res) => {
	try {
		const storeId = req?.body?.storeId || 'store_unicommerce_001';
		const facilityCode = req?.body?.facilityCode || 'FACILITY_DELHI_01';
		const summary = await runUnicommerceInventorySync(storeId, facilityCode);
		res.json({ success: true, message: 'Unicommerce inventory sync complete', summary });
	} catch (error) {
		logger.error({
			message: 'Unicommerce sync failed',
			platform: 'unicommerce',
			error: error?.message || String(error)
		});
		res.status(500).json({ success: false, error: error?.message || 'Unicommerce sync failed' });
	}
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
	logger.info({ message: 'Server started successfully', port });
});