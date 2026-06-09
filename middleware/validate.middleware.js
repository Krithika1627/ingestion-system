const VALID_SORT_VALUES = ['price_asc', 'price_desc', 'updated_at', 'relevance'];
const VALID_PLATFORMS = ['shopify', 'magento', 'woocommerce', 'bigcommerce', 'unicommerce', 'scraped'];
const VALID_AVAILABILITY = ['inStock', 'outOfStock'];

function validateSearchParams(req, res, next) {
  const rawQ = req.query.q;
  const rawMinPrice = req.query.min_price;
  const rawMaxPrice = req.query.max_price;
  const rawSort = req.query.sort;
  const rawPage = req.query.page;
  const rawLimit = req.query.limit;
  const rawCategory = req.query.category;
  const rawBrand = req.query.brand;
  const rawPlatform = req.query.platform;
  const rawAvailability = req.query.availability;

  // q is required
  if (!rawQ || typeof rawQ !== 'string' || rawQ.trim().length < 1) {
    res.status(400).json({
      success: false,
      error: "Search query 'q' is required",
      code: 400
    });
    return;
  }

  // Validate page
  let page = 1;
  if (rawPage !== undefined && rawPage !== null) {
    page = Number(rawPage);
    if (!Number.isInteger(page) || page < 1) {
      res.status(400).json({
        success: false,
        error: 'Invalid param: page must be a positive integer',
        code: 400
      });
      return;
    }
  }

  // Validate limit
  let limit = 20;
  if (rawLimit !== undefined && rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      res.status(400).json({
        success: false,
        error: 'Invalid param: limit must be an integer between 1 and 100',
        code: 400
      });
      return;
    }
  }

  // Validate sort
  let sort = 'relevance';
  if (rawSort) {
    if (!VALID_SORT_VALUES.includes(rawSort)) {
      res.status(400).json({
        success: false,
        error: `Invalid param: sort must be one of ${VALID_SORT_VALUES.join(', ')}`,
        code: 400
      });
      return;
    }
    sort = rawSort;
  }

  // Validate platform
  if (rawPlatform && !VALID_PLATFORMS.includes(rawPlatform)) {
    res.status(400).json({
      success: false,
      error: `Invalid param: platform must be one of ${VALID_PLATFORMS.join(', ')}`,
      code: 400
    });
    return;
  }

  // Validate availability
  if (rawAvailability && !VALID_AVAILABILITY.includes(rawAvailability)) {
    res.status(400).json({
      success: false,
      error: `Invalid param: availability must be one of ${VALID_AVAILABILITY.join(', ')}`,
      code: 400
    });
    return;
  }

  // Validate min_price
  let minPrice = null;
  if (rawMinPrice !== undefined && rawMinPrice !== null && rawMinPrice !== '') {
    minPrice = Number(rawMinPrice);
    if (!Number.isFinite(minPrice) || minPrice < 0) {
      res.status(400).json({
        success: false,
        error: 'Invalid param: min_price must be a valid non-negative number',
        code: 400
      });
      return;
    }
  }

  // Validate max_price
  let maxPrice = null;
  if (rawMaxPrice !== undefined && rawMaxPrice !== null && rawMaxPrice !== '') {
    maxPrice = Number(rawMaxPrice);
    if (!Number.isFinite(maxPrice) || maxPrice < 0) {
      res.status(400).json({
        success: false,
        error: 'Invalid param: max_price must be a valid non-negative number',
        code: 400
      });
      return;
    }
  }

  // Validate max_price >= min_price if both provided
  if (minPrice !== null && maxPrice !== null && maxPrice < minPrice) {
    res.status(400).json({
      success: false,
      error: 'Invalid param: max_price must be greater than or equal to min_price',
      code: 400
    });
    return;
  }

  req.validated = {
    q: rawQ.trim(),
    page,
    limit,
    sort,
    category: rawCategory || null,
    brand: rawBrand || null,
    platform: rawPlatform || null,
    availability: rawAvailability || null,
    min_price: minPrice,
    max_price: maxPrice
  };

  next();
}

function validatePagination(req, res, next) {
  const rawPage = req.query.page;
  const rawLimit = req.query.limit;
  const rawSort = req.query.sort;
  const rawCategory = req.query.category;
  const rawBrand = req.query.brand;
  const rawPlatform = req.query.platform;
  const rawAvailability = req.query.availability;
  const rawStoreId = req.query.storeId;

  let page = 1;
  if (rawPage !== undefined && rawPage !== null) {
    page = Number(rawPage);
    if (!Number.isInteger(page) || page < 1) {
      res.status(400).json({
        success: false,
        error: 'Invalid param: page must be a positive integer',
        code: 400
      });
      return;
    }
  }

  let limit = 20;
  if (rawLimit !== undefined && rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      res.status(400).json({
        success: false,
        error: 'Invalid param: limit must be an integer between 1 and 100',
        code: 400
      });
      return;
    }
  }

  if (rawSort && !VALID_SORT_VALUES.includes(rawSort)) {
    return res.status(400).json({
      success: false,
      error: `Invalid param: sort must be one of ${VALID_SORT_VALUES.join(', ')}`,
      code: 400
    });
  }

  const sort = rawSort || 'updated_at';
  
  if (rawPlatform && !VALID_PLATFORMS.includes(rawPlatform)) {
    res.status(400).json({
      success: false,
      error: `Invalid param: platform must be one of ${VALID_PLATFORMS.join(', ')}`,
      code: 400
    });
    return;
  }

  if (rawAvailability && !VALID_AVAILABILITY.includes(rawAvailability)) {
    res.status(400).json({
      success: false,
      error: `Invalid param: availability must be one of ${VALID_AVAILABILITY.join(', ')}`,
      code: 400
    });
    return;
  }

  req.validated = {
    page,
    limit,
    sort,
    category: rawCategory || null,
    brand: rawBrand || null,
    platform: rawPlatform || null,
    availability: rawAvailability || null,
    storeId: rawStoreId || null
  };

  next();
}

function validateProductId(req, res, next) {
  const { id } = req.params;

  if (!id || typeof id !== 'string' || !id.startsWith('cprod_')) {
    res.status(400).json({
      success: false,
      error: 'Invalid param: product ID must start with cprod_',
      code: 400
    });
    return;
  }

  next();
}

module.exports = {
  validateSearchParams,
  validatePagination,
  validateProductId,
  VALID_SORT_VALUES,
  VALID_PLATFORMS,
  VALID_AVAILABILITY
};
