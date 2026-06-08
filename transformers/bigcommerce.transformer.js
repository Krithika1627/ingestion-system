const { randomUUID } = require('crypto');

function stripHtml(str) {
	if (!str) {
		return null;
	}
	const result = String(str).replace(/<[^>]*>/g, '').trim();
	return result || null;
}

function extractCustomField(customFields, name) {
	if (!Array.isArray(customFields) || customFields.length === 0) {
		return null;
	}
	const field = customFields.find(
		(item) => typeof item?.name === 'string' && item.name.toLowerCase() === name.toLowerCase()
	);
	return field?.value || null;
}

function deriveStatus(product) {
	if (product?.availability === 'preorder') {
		return 'preorder';
	}
	if (product?.is_visible === false) {
		return 'inactive';
	}
	return 'active';
}

function resolveStockQty(product) {
	if (product?.inventory_tracking === 'variant') {
		return (product?.variants || []).reduce(
			(sum, variant) => sum + (variant?.inventory_level || 0),
			0
		);
	}
	if (product?.inventory_tracking === 'none') {
		return null;
	}
	return product?.inventory_level ?? null;
}

function deriveAvailability(qty, threshold = 10) {
	if (qty === null || qty === undefined) {
		return 'in_stock';
	}
	if (qty === 0) {
		return 'out_of_stock';
	}
	if (qty <= threshold) {
		return 'limited';
	}
	return 'in_stock';
}

function getMapValue(mapLike, key) {
	if (mapLike instanceof Map) {
		return mapLike.get(key) ?? mapLike.get(String(key));
	}
	if (mapLike && typeof mapLike === 'object') {
		return mapLike[key] ?? mapLike[String(key)];
	}
	return null;
}

function transformProduct(item, storeId, options = {}) {
	const sourceItem = item || {};
	const categoryIdMap = options?.categoryIdMap;
	const brandMap = options?.brandMap;
	const sku = typeof sourceItem?.sku === 'string' && sourceItem.sku.trim().length > 0
		? sourceItem.sku
		: null;
	const tags = sourceItem?.search_keywords
		? String(sourceItem.search_keywords)
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean)
		: [];
	const rawCategoryIds = Array.isArray(sourceItem?.categories)
		? sourceItem.categories.map((id) => String(id))
		: [];
	const categoryIds = categoryIdMap
		? Array.from(
			new Set(
				rawCategoryIds
					.map((id) => getMapValue(categoryIdMap, id))
					.filter(Boolean)
			)
		)
		: [];
	const description = stripHtml(sourceItem?.description);
	const customFields = Array.isArray(sourceItem?.custom_fields)
		? sourceItem.custom_fields
		: [];

	const attributes = customFields.reduce((acc, field) => {
		const name = typeof field?.name === 'string' ? field.name.trim() : '';
		const value = typeof field?.value === 'string' ? field.value.trim() : '';
		if (!name || !value) {
			return acc;
		}
		if (name.toLowerCase() === 'brand' || name.toLowerCase() === 'description') {
			return acc;
		}
		acc[name] = value;
		return acc;
	}, {});

	const images = [];
	const seenImages = new Set();
	const addImage = (url, altText, position) => {
		if (!url) {
			return;
		}
		const normalizedUrl = String(url).trim();
		if (!normalizedUrl || seenImages.has(normalizedUrl)) {
			return;
		}
		const entry = { url: normalizedUrl, altText: altText || null };
		if (Number.isFinite(position)) {
			entry.position = position;
		}
		images.push(entry);
		seenImages.add(normalizedUrl);
	};

	addImage(
		sourceItem?.primary_image?.url_standard,
		sourceItem?.primary_image?.description || null,
		Number.isFinite(sourceItem?.primary_image?.sort_order)
			? sourceItem.primary_image.sort_order
			: 0
	);

	if (Array.isArray(sourceItem?.images)) {
		for (const image of sourceItem.images) {
			addImage(
				image?.url_standard || image?.url_zoom || null,
				image?.description || null,
				Number.isFinite(image?.sort_order) ? image.sort_order : null
			);
		}
	}

	if (Array.isArray(sourceItem?.variants)) {
		for (const variant of sourceItem.variants) {
			addImage(variant?.image_url || null, null, null);
		}
	}

	const variants = Array.isArray(sourceItem?.variants) && sourceItem.variants.length > 0
		? sourceItem.variants.map((variant) => {
			const variantPrice = Number.parseFloat(variant?.price);
			const itemPrice = Number.parseFloat(sourceItem?.price);
			const price = Number.isFinite(variantPrice)
				? variantPrice
				: Number.isFinite(itemPrice)
					? itemPrice
					: 0;

			const retailPrice = Number.parseFloat(variant?.retail_price);
			const compareAtPrice = Number.isFinite(retailPrice) && retailPrice !== price
				? retailPrice
				: null;

			const optionTitle = (variant?.option_values || [])
				.map((opt) => opt?.label)
				.filter(Boolean)
				.join(' / ');

			return {
				variantId: variant?.id !== undefined && variant?.id !== null ? String(variant.id) : null,
				title: optionTitle || null,
				sku: typeof variant?.sku === 'string' && variant.sku.trim().length > 0 ? variant.sku : null,
				price,
				compareAtPrice,
				currency: 'INR',
				inventoryQty: variant?.inventory_level ?? null,
				isInStock: (variant?.inventory_level ?? 0) > 0,
				imageUrl: variant?.image_url || null,
				options: (variant?.option_values || []).map((opt) => ({
					name: opt?.option_display_name || null,
					value: opt?.label || null
				}))
			};
		})
		: [
			{
				variantId: sku || (sourceItem?.id !== undefined && sourceItem?.id !== null ? String(sourceItem.id) : null),
				title: null,
				sku: sku || null,
				price: Number.isFinite(Number.parseFloat(sourceItem?.price))
					? Number.parseFloat(sourceItem.price)
					: 0,
				compareAtPrice: null,
				currency: 'INR',
				inventoryQty: sourceItem?.inventory_level ?? null,
				isInStock: (sourceItem?.inventory_level ?? 0) > 0,
				imageUrl: sourceItem?.primary_image?.url_standard || null,
				options: []
			}
		];

	const cleanedTitle = typeof sourceItem?.name === 'string'
		? sourceItem.name.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim()
		: '';

	const resolvedBrandName =
		(typeof sourceItem?.brand_name === 'string' && sourceItem.brand_name.trim().length > 0
			? sourceItem.brand_name.trim()
			: null) ||
		(sourceItem?.brand_id !== undefined && sourceItem?.brand_id !== null
			? getMapValue(brandMap, sourceItem.brand_id)
			: null);

	const normalizedBrand = typeof resolvedBrandName === 'string'
		? resolvedBrandName.toLowerCase().trim()
		: null;

	return {
		id: randomUUID(),
		sourceId: sourceItem?.id !== undefined && sourceItem?.id !== null ? String(sourceItem.id) : null,
		source: 'bigcommerce',
		storeId,
		sku,
		title: typeof sourceItem?.name === 'string' ? sourceItem.name : '',
		description,
		brand: resolvedBrandName || null,
		category: null,
		productType: sourceItem?.type || null,
		tags,
		status: deriveStatus(sourceItem),
		weight: sourceItem?.weight ?? null,
		images,
		attributes,
		variants,
		categoryIds,
		inventoryTracking: sourceItem?.inventory_tracking || null,
		customUrl: sourceItem?.custom_url?.url || null,
		createdAt: sourceItem?.date_created || null,
		updatedAt: sourceItem?.date_modified || null,
		lastSyncedAt: new Date().toISOString(),
		cleanedTitle,
		normalizedBrand,
		pricePerUnit: null
	};
}

function transformCategory(node, storeId) {
	const sourceNode = node || {};
	const slug = typeof sourceNode?.url === 'string'
		? sourceNode.url.replace(/^\/|\/$/g, '')
		: null;

	return {
		id: randomUUID(),
		sourceId: sourceNode?.id !== undefined && sourceNode?.id !== null ? String(sourceNode.id) : null,
		source: 'bigcommerce',
		storeId,
		name: typeof sourceNode?.name === 'string' ? sourceNode.name : '',
		slug: slug || null,
		description: null,
		parentSourceId:
			sourceNode?.parent_id === 0 || sourceNode?.parent_id === '0'
				? null
				: sourceNode?.parent_id !== undefined && sourceNode?.parent_id !== null
					? String(sourceNode.parent_id)
					: null,
		parentId: null,
		level: null,
		isActive: true,
		includeInMenu: true,
		path: sourceNode?.url || null,
		imageUrl: sourceNode?.image_url || null,
		productCount: null,
        treeId: sourceNode?.tree_id ? String(sourceNode.tree_id) : null,		position: null,
		children: [],
		createdAt: null,
		updatedAt: null,
		lastSyncedAt: new Date().toISOString()
	};
}

module.exports = {
	transformProduct,
	transformCategory,
	stripHtml,
	extractCustomField,
	deriveAvailability,
	resolveStockQty
};
