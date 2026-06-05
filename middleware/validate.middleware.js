/**
 * Request validation middleware.
 *
 * Provides reusable validators for common API parameters:
 *  - validatePagination: ensures page/limit are positive integers within bounds
 *  - validateProductId:  ensures :id starts with 'cprod_'
 */
const VALID_SORT_VALUES = ['price_asc', 'price_desc', 'updated_at', 'relevance'];
const VALID_PLATFORMS = ['shopify', 'magento', 'woocommerce', 'bigcommerce', 'unicommerce', 'scraped'];
const VALID_AVAILABILITY = ['inStock', 'outOfStock'];

/**
 * Validate pagination and common query parameters for GET /products.
 *
 * On failure, sends a 400 response directly and returns false.
 * On success, attaches validated params to req.validated and returns true.
 *
 * @param {object}  req  — Express request
 * @param {object}  res  — Express response
 * @param {function} next — Express next
 */
function validatePagination(req, res, next) {
  const rawPage = req.query.page;
  const rawLimit = req.query.limit;
  const rawSort = req.query.sort;
  const rawCategory = req.query.category;
  const rawBrand = req.query.brand;
  const rawPlatform = req.query.platform;
  const rawAvailability = req.query.availability;
  const rawStoreId = req.query.storeId;

  /* Page */
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

  /* Limit */
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

  /* Sort */
  if (rawSort && !VALID_SORT_VALUES.includes(rawSort)) {
    return res.status(400).json({
      success: false,
      error: `Invalid param: sort must be one of ${VALID_SORT_VALUES.join(', ')}`,
      code: 400
    });
  }

  const sort = rawSort || 'updated_at';
  
  /* Platform */
  if (rawPlatform && !VALID_PLATFORMS.includes(rawPlatform)) {
    res.status(400).json({
      success: false,
      error: `Invalid param: platform must be one of ${VALID_PLATFORMS.join(', ')}`,
      code: 400
    });
    return;
  }

  /* Availability */
  if (rawAvailability && !VALID_AVAILABILITY.includes(rawAvailability)) {
    res.status(400).json({
      success: false,
      error: `Invalid param: availability must be one of ${VALID_AVAILABILITY.join(', ')}`,
      code: 400
    });
    return;
  }

  /* Attach validated params */
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

/**
 * Validate that the product ID (:id param) starts with 'cprod_'.
 *
 * On failure, sends a 400 response.
 *
 * @param {object}  req  — Express request
 * @param {object}  res  — Express response
 * @param {function} next — Express next
 */
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
  validatePagination,
  validateProductId,
  VALID_SORT_VALUES,
  VALID_PLATFORMS,
  VALID_AVAILABILITY
};
