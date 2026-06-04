/**
 * Shopify GraphQL connector for fetching products and collections with pagination,
 * rate limit handling, and retry logic.
 */
const axios = require('axios');
const logger = require('../services/logger.service');

const http = axios.create({ timeout: 30000 });

const DEFAULT_PAGE_SIZE = 50;
const MAX_RETRIES = 3;
const RETRY_STATUSES = new Set([429, 500, 502, 503]);

const PRODUCTS_QUERY = `
  query Products($first: Int!, $after: String, $since: String) {
    products(first: $first, after: $after, query: $since) {
      edges {
        node {
          id
          title
          description
          vendor
          productType
          status
          tags
          createdAt
          updatedAt
          priceRangeV2 {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          variants(first: 50) {
            edges {
              node {
                id
                sku
                price
                compareAtPrice
                inventoryQuantity
              }
            }
          }
          media(first: 10) {
            edges {
              node {
                preview {
                  image {
                    url
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const COLLECTIONS_QUERY = `
  query getCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          description
          updatedAt
          image {
            url
          }
          productsCount {
            count
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const COLLECTION_PRODUCTS_QUERY = `
  query getCollectionProducts($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      products(first: $first, after: $after) {
        edges {
          node {
            id
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEndpoint() {
  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const apiVersion = process.env.SHOPIFY_API_VERSION;

  if (!storeUrl || !apiVersion) {
    throw new Error('SHOPIFY_STORE_URL or SHOPIFY_API_VERSION is not configured');
  }

  return `${storeUrl.replace(/\/$/, '')}/admin/api/${apiVersion}/graphql.json`;
}

function getHeaders() {
  const token = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!token) {
    throw new Error('SHOPIFY_ACCESS_TOKEN is not configured');
  }

  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': token
  };
}

async function handleRateLimit(data, context) {
  const throttleStatus = data?.extensions?.cost?.throttleStatus;
  if (!throttleStatus) {
    return;
  }

  const currentlyAvailable = throttleStatus.currentlyAvailable;
  const restoreRate = throttleStatus.restoreRate;

  if (
    typeof currentlyAvailable === 'number' &&
    typeof restoreRate === 'number' &&
    currentlyAvailable < 200
  ) {
    const waitSeconds = (200 - currentlyAvailable) / restoreRate;
    const waitMs = Math.ceil(waitSeconds * 1000);
    logger.warn({
      message: 'Shopify rate limit pause',
      platform: 'shopify',
      pointsRemaining: currentlyAvailable,
      restoreRate,
      waitMs,
      ...context
    });
    await sleep(waitMs);
  }
}

async function requestGraphQL(payload, context) {
  const endpoint = getEndpoint();
  const headers = getHeaders();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await http.post(endpoint, payload, { headers });
      const data = response?.data;

      const errors = data?.errors || [];
      const hasMaxCostError = errors.some(
        (error) => error?.extensions?.code === 'MAX_COST_EXCEEDED'
      );

      if (hasMaxCostError) {
        logger.warn({
          message: 'Shopify GraphQL max cost exceeded, waiting to retry',
          platform: 'shopify',
          attempt,
          endpoint,
          ...context
        });
        if (attempt === MAX_RETRIES) {
          throw new Error('Shopify GraphQL MAX_COST_EXCEEDED');
        }
        await sleep(10000);
        continue;
      }

      if (errors.length > 0) {
        const errorSummary = errors
          .map((error) => error?.message || 'Unknown GraphQL error')
          .join('; ');
        const graphQLError = new Error(`Shopify GraphQL error: ${errorSummary}`);
        graphQLError.isGraphQLError = true;
        throw graphQLError;
      }

      return data;
    } catch (error) {
      const status = error?.response?.status;
      const isGraphQLError = error?.isGraphQLError === true;
      const isRetriable = status ? RETRY_STATUSES.has(status) : !isGraphQLError;

      if (
        isGraphQLError ||
        !isRetriable ||
        attempt === MAX_RETRIES ||
        [401, 403, 404].includes(status)
      ) {
        logger.error({
          message: 'Shopify GraphQL request failed',
          platform: 'shopify',
          endpoint,
          attempt,
          status: status || 'network',
          error: error?.message || String(error),
          ...context
        });
        throw error;
      }

      const waitMs = 1000 * 2 ** (attempt - 1);
      logger.warn({
        message: 'Retrying Shopify GraphQL request',
        platform: 'shopify',
        endpoint,
        attempt,
        waitMs,
        status: status || 'network',
        error: error?.message || String(error),
        ...context
      });
      await sleep(waitMs);
    }
  }

  throw new Error('Shopify GraphQL request failed after retries');
}

/**
 * Fetch all products from Shopify with cursor-based pagination.
 * Supports incremental sync via optional since parameter.
 * @param {string} storeId
 * @param {Date|null} [since] - Only fetch products updated after this date
 * @returns {Promise<object[]>}
 */
async function fetchProducts(storeId, since) {
  const startTime = Date.now();
  const context = { storeId };
  let hasNextPage = true;
  let cursor = null;
  let page = 0;
  const products = [];

  logger.info({ message: 'Shopify product sync started', platform: 'shopify', ...context });

  if (since && !(since instanceof Date)) {
    since = new Date(since);
  }
  if (since) {
    logger.info({
      message: 'Shopify incremental sync filter applied',
      platform: 'shopify',
      since: since.toISOString(),
      ...context
    });
  }

  while (hasNextPage) {
    page += 1;
    const variables = { first: DEFAULT_PAGE_SIZE, after: cursor };
    if (since) {
      variables.since = `updated_at:>=${since.toISOString()}`;
    }
    const payload = {
      query: PRODUCTS_QUERY,
      variables
    };

    const data = await requestGraphQL(payload, { ...context, page });
    const edges = data?.data?.products?.edges || [];
    const pageInfo = data?.data?.products?.pageInfo;
    const nodes = edges.map((edge) => edge?.node).filter(Boolean);

    products.push(...nodes);

    logger.info({
      message: 'Shopify products page fetched',
      platform: 'shopify',
      page,
      count: nodes.length,
      ...context
    });

    await handleRateLimit(data, { ...context, page });

    hasNextPage = Boolean(pageInfo?.hasNextPage);
    cursor = pageInfo?.endCursor || null;
  }

  const durationSec = Number(((Date.now() - startTime) / 1000).toFixed(2));
  logger.info({
    message: 'Shopify product sync complete',
    platform: 'shopify',
    total: products.length,
    durationSec,
    ...context
  });

  return products;
}

/**
 * Fetch all collections from Shopify with cursor-based pagination.
 * @param {string} storeId
 * @returns {Promise<object[]>}
 */
async function fetchCollections(storeId) {
  const context = { storeId };
  let hasNextPage = true;
  let cursor = null;
  let page = 0;
  const collections = [];

  logger.info({
    message: 'Shopify collections sync started',
    platform: 'shopify',
    ...context
  });

  while (hasNextPage) {
    page += 1;
    const payload = {
      query: COLLECTIONS_QUERY,
      variables: { first: DEFAULT_PAGE_SIZE, after: cursor }
    };

    const data = await requestGraphQL(payload, { ...context, page });
    const edges = data?.data?.collections?.edges || [];
    const pageInfo = data?.data?.collections?.pageInfo;
    const nodes = edges.map((edge) => edge?.node).filter(Boolean);

    collections.push(...nodes);

    logger.info({
      message: 'Shopify collections page fetched',
      platform: 'shopify',
      page,
      count: nodes.length,
      ...context
    });

    await handleRateLimit(data, { ...context, page });

    hasNextPage = Boolean(pageInfo?.hasNextPage);
    cursor = pageInfo?.endCursor || null;
  }

  logger.info({
    message: 'Shopify collections sync complete',
    platform: 'shopify',
    total: collections.length,
    ...context
  });

  return collections;
}

/**
 * Fetch product GIDs for a Shopify collection with cursor-based pagination.
 * @param {string} storeId
 * @param {string} collectionSourceId
 * @returns {Promise<string[]>}
 */
async function fetchCollectionProducts(storeId, collectionSourceId) {
  const context = { storeId, collectionSourceId };
  let hasNextPage = true;
  let cursor = null;
  let page = 0;
  const productIds = [];

  if (!collectionSourceId) {
    logger.warn({
      message: 'Missing collectionSourceId for collection products fetch',
      platform: 'shopify',
      ...context
    });
    return productIds;
  }

  logger.info({
    message: 'Shopify collection products fetch started',
    platform: 'shopify',
    ...context
  });

  while (hasNextPage) {
    page += 1;
    const payload = {
      query: COLLECTION_PRODUCTS_QUERY,
      variables: { id: collectionSourceId, first: DEFAULT_PAGE_SIZE, after: cursor }
    };

    const data = await requestGraphQL(payload, { ...context, page });
    const productsData = data?.data?.collection?.products;
    const edges = productsData?.edges || [];
    const pageInfo = productsData?.pageInfo;
    const nodes = edges.map((edge) => edge?.node?.id).filter(Boolean);

    if (!productsData) {
      logger.warn({
        message: 'Shopify collection products missing in response',
        platform: 'shopify',
        ...context
      });
      break;
    }

    productIds.push(...nodes);

    logger.info({
      message: 'Shopify collection products page fetched',
      platform: 'shopify',
      page,
      count: nodes.length,
      ...context
    });

    await handleRateLimit(data, { ...context, page });

    hasNextPage = Boolean(pageInfo?.hasNextPage);
    cursor = pageInfo?.endCursor || null;
  }

  logger.info({
    message: 'Shopify collection products fetch complete',
    platform: 'shopify',
    total: productIds.length,
    ...context
  });

  return productIds;
}

module.exports = { fetchProducts, fetchCollections, fetchCollectionProducts };