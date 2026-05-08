/**
 * Express API entry point exposing Shopify sync endpoint.
 */
require('dotenv').config();

const express = require('express');
const logger = require('./services/logger.service');
const { runShopifyFullSync } = require('./pipelines/shopify.pipeline');
const { runShopifyCategoryPipeline } = require('./pipelines/category.pipeline');

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

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
	logger.info({ message: 'Server started successfully', port });
});