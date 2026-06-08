const { randomUUID } = require('crypto');

function safeArray(value) {
	return Array.isArray(value) ? value : [];
}

function toNullableString(value) {
	if (typeof value !== 'string') {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function parseNumber(value) {
	const parsed = parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function cleanTitle(value) {
	if (typeof value !== 'string') {
		return null;
	}

	return value
		.replace(/<[^>]+>/g, '')
		.replace(/[®™©]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function normalizeStatus(status) {
	if (typeof status !== 'string') {
		return null;
	}

	switch (status.toUpperCase()) {
		case 'ACTIVE':
			return 'active';
		case 'DRAFT':
			return 'draft';
		case 'ARCHIVED':
			return 'archived';
		default:
			return status.toLowerCase();
	}
}

function transformProduct(node, storeId) {
	const sourceNode = node || {};
	const variantsEdges = safeArray(sourceNode?.variants?.edges);
	const variantNodes = variantsEdges.map((edge) => edge?.node).filter(Boolean);
	const priceCurrency =
		sourceNode?.priceRangeV2?.minVariantPrice?.currencyCode || 'INR';

	const variants = variantNodes.map((variant) => {
		const price = parseNumber(variant?.price);
		const compareAt = parseNumber(variant?.compareAtPrice);
		const normalizedPrice = price ?? 0;
		const compareAtPrice =
			compareAt !== null && compareAt !== normalizedPrice ? compareAt : null;
		const sku = toNullableString(variant?.sku);
		const inventoryQty =
			typeof variant?.inventoryQuantity === 'number'
				? variant.inventoryQuantity
				: null;

		return {
			variantId: variant?.id || null,
			title: null,
			sku,
			price: normalizedPrice,
			compareAtPrice,
			currency: priceCurrency,
			inventoryQty,
			isInStock: (inventoryQty || 0) > 0
		};
	});

	const mediaEdges = safeArray(sourceNode?.media?.edges);
	const images = mediaEdges
		.map((edge, index) => {
			const url = edge?.node?.preview?.image?.url;
			const trimmedUrl = typeof url === 'string' ? url.trim() : '';
			if (!trimmedUrl) {
				return null;
			}
			return { url: trimmedUrl, altText: null, position: index };
		})
		.filter(Boolean);

	const vendor = toNullableString(sourceNode?.vendor);
	const productType = toNullableString(sourceNode?.productType);
	const description = toNullableString(sourceNode?.description);
	const title = typeof sourceNode?.title === 'string' ? sourceNode.title : '';

	return {
		id: randomUUID(),
		sourceId: sourceNode?.id || null,
		source: 'shopify',
		storeId,
		sku: toNullableString(variantNodes?.[0]?.sku),
		title,
		description,
		brand: vendor,
		category: productType,
		productType: 'unknown',
		tags: safeArray(sourceNode?.tags),
		categoryIds: [],
		status: normalizeStatus(sourceNode?.status),
		images,
		variants,
		createdAt: sourceNode?.createdAt || null,
		updatedAt: sourceNode?.updatedAt || null,
		lastSyncedAt: new Date().toISOString(),
		cleanedTitle: cleanTitle(title),
		normalizedBrand: vendor ? vendor.toLowerCase().trim() : null,
		pricePerUnit: null
	};
}

function transformCollection(node, storeId) {
	const sourceNode = node || {};
	const imageUrl = toNullableString(sourceNode?.image?.url);
	const productsCount = sourceNode?.productsCount;
	const productCount =
		typeof productsCount === 'number'
			? productsCount
			: typeof productsCount?.count === 'number'
				? productsCount.count
				: null;

	return {
		id: randomUUID(),
		sourceId: sourceNode?.id || null,
		source: 'shopify',
		storeId,
		name: typeof sourceNode?.title === 'string' ? sourceNode.title : '',
		slug: toNullableString(sourceNode?.handle),
		description: toNullableString(sourceNode?.description),
		imageUrl,
		productCount,
		parentId: null,
		level: 0,
		isActive: true,
		includeInMenu: null,
		path: null,
		children: [],
		position: null,
		treeId: null,
		createdAt: null,
		updatedAt: sourceNode?.updatedAt || null,
		lastSyncedAt: new Date().toISOString()
	};
}

module.exports = { transformProduct, transformCollection };
