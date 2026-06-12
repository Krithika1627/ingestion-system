require('dotenv').config();

const express = require('express');
const logger = require('./services/logger.service');
const { connectDB } = require('./services/db.service');
const { loadSchedules } = require('./services/scheduler.service');
const schedulerRoutes = require('./connectors/scheduler.routes');
const webhookRoutes = require('./connectors/webhook.routes');
const productRoutes = require('./routes/product.routes');
const storeRoutes = require('./routes/store.routes');
const offerRoutes = require('./routes/offer.routes');
const searchRoutes = require('./routes/search.routes');
const aiRoutes = require('./routes/ai.routes');
const errorMiddleware = require('./middleware/error.middleware');
const { ensureTextIndex } = require('./services/search-api.service');
const { runShopifyFullSync } = require('./pipelines/shopify.pipeline');
const { runShopifyCategoryPipeline, runMagentoCategoryPipeline, runWooCategoryPipeline, runBigCommerceCategoryPipeline } = require('./pipelines/category.pipeline');
const { runMagentoFullSync } = require('./pipelines/magento.pipeline');
const { runWooFullSync } = require('./pipelines/woocommerce.pipeline');
const { runUnicommerceInventorySync } = require('./pipelines/unicommerce.pipeline');
const { runBigCommerceFullSync } = require('./pipelines/bigcommerce.pipeline');
const { runBigCommerceProductPipeline } = require('./pipelines/product.pipeline');
const auth = require('./middleware/auth');

const app = express();
app.use('/webhooks', webhookRoutes);
app.use(express.json());
app.use('/scheduler', schedulerRoutes);
app.use('/products', auth, productRoutes);
app.use('/stores', auth, storeRoutes);
app.use('/offers', auth, offerRoutes);
app.use('/search', auth, searchRoutes);
app.use('/ai', auth, aiRoutes);

function normalizeInput(value) {
	if (value === undefined || value === null) {
		return null;
	}

	if (typeof value !== 'string') {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function readOptionalInput(value, fallback, field, res) {
	if (value === undefined || value === null) {
		return fallback;
	}

	const normalized = normalizeInput(value);
	if (!normalized) {
		res.status(400).json({ success: false, error: `${field} required` });
		return null;
	}

	return normalized;
}

app.post('/sync/shopify', async (req, res) => {
	const storeId = readOptionalInput(req?.body?.storeId, 'store_shopify_001', 'storeId', res);
	if (!storeId) {
		return;
	}

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
		const storeId = readOptionalInput(req?.body?.storeId, 'store_woo_001', 'storeId', res);
		if (!storeId) {
			return;
		}
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
		const storeId = readOptionalInput(req?.body?.storeId, 'store_unicommerce_001', 'storeId', res);
		if (!storeId) {
			return;
		}
		const facilityCode = readOptionalInput(
			req?.body?.facilityCode,
			'FACILITY_DELHI_01',
			'facilityCode',
			res
		);
		if (!facilityCode) {
			return;
		}
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

app.post('/sync/bigcommerce', async (req, res) => {
	try {
		const storeId = readOptionalInput(req?.body?.storeId, 'store_bigcommerce_001', 'storeId', res);
		if (!storeId) {
			return;
		}
		const summary = await runBigCommerceFullSync(storeId);
		res.json({ success: true, message: 'BigCommerce sync complete', summary });
	} catch (error) {
		logger.error({
			message: 'BigCommerce sync failed',
			platform: 'bigcommerce',
			error: error?.message || String(error)
		});
		res.status(500).json({ success: false, error: error?.message || 'BigCommerce sync failed' });
	}
});

app.post('/sync/bigcommerce/categories', async (req, res) => {
	try {
		const summary = await runBigCommerceCategoryPipeline('store_bigcommerce_001');
		res.json({ success: true, message: 'BigCommerce category sync complete', summary });
	} catch (error) {
		res.status(500).json({ success: false, error: error?.message || 'BigCommerce category sync failed' });
	}
});

app.post('/sync/bigcommerce/products', async (req, res) => {
	try {
		const summary = await runBigCommerceProductPipeline('store_bigcommerce_001');
		res.json({ success: true, message: 'BigCommerce product sync complete', summary });
	} catch (error) {
		res.status(500).json({ success: false, error: error?.message || 'BigCommerce product sync failed' });
	}
});

const port = Number(process.env.PORT) || 3000;
async function initializeScheduler() {
	try {
		await connectDB();
		await loadSchedules();
		logger.info({ message: 'Scheduler initialized', service: 'scheduler' });
	} catch (error) {
		logger.error({
			message: 'Scheduler initialization failed',
			service: 'scheduler',
			error: error?.message || String(error)
		});
	}
}

initializeScheduler();
ensureTextIndex();

app.use(errorMiddleware);

app.listen(port, () => {
	logger.info({ message: 'Server started successfully', port });
});