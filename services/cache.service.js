const NodeCache = require('node-cache');
const logger = require('./logger.service');

const shortCache = new NodeCache({ stdTTL: 300 });    /* 5 minutes */
const mediumCache = new NodeCache({ stdTTL: 600 });   /* 10 minutes */
const longCache = new NodeCache({ stdTTL: 1800 });    /* 30 minutes */

const ALL_CACHES = {
  short: shortCache,
  medium: mediumCache,
  long: longCache
};

function get(cacheInstance, key) {
  const value = cacheInstance.get(key);

  if (value !== undefined) {
    logger.info({
      message: 'Cache hit',
      service: 'cache',
      key
    });
    return value;
  }

  logger.info({
    message: 'Cache miss',
    service: 'cache',
    key
  });

  return null;
}

function set(cacheInstance, key, value) {
  cacheInstance.set(key, value);
  logger.info({
    message: 'Cache set',
    service: 'cache',
    key,
    ttl: cacheInstance.options.stdTTL
  });
}

function invalidate(pattern) {
  let deletedCount = 0;

  for (const [name, cache] of Object.entries(ALL_CACHES)) {
    const keys = cache.keys();
    const matchingKeys = keys.filter((k) => k.includes(pattern));

    if (matchingKeys.length > 0) {
      cache.del(matchingKeys);
      deletedCount += matchingKeys.length;

      logger.info({
        message: 'Cache keys invalidated',
        service: 'cache',
        cache: name,
        pattern,
        count: matchingKeys.length
      });
    }
  }

  logger.info({
    message: 'Cache invalidated',
    service: 'cache',
    pattern,
    count: deletedCount
  });

  return deletedCount;
}

function buildKey(route, params = {}) {
  const sortedKeys = Object.keys(params).sort();
  const paramParts = sortedKeys
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .map((k) => `${k}=${params[k]}`);

  if (paramParts.length === 0) {
    return route;
  }

  return `${route}:${paramParts.join(':')}`;
}

function getCacheStats() {
  const stats = {};

  for (const [name, cache] of Object.entries(ALL_CACHES)) {
    const cacheStats = cache.getStats();
    stats[name] = {
      keys: cache.keys().length,
      hits: cacheStats.hits || 0,
      misses: cacheStats.misses || 0
    };
  }

  return stats;
}

module.exports = {
  get,
  set,
  invalidate,
  buildKey,
  getCacheStats,
  shortCache,
  mediumCache,
  longCache
};
