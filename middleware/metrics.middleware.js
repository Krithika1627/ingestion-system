const logger = require('../services/logger.service');
const { recordApiMetric } = require('../services/metrics.service');

const metricsMiddleware = async (req, res, next) => {
  const start = Date.now();

  // Intercept res.json to capture status code and duration
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const durationMs = Date.now() - start;
    const endpoint = req.method + ' ' + (req.route?.path || req.path);
    const isError = res.statusCode >= 400;

    // Fire and forget — don't block the response
    recordApiMetric(endpoint, durationMs, isError).catch((err) =>
      logger.warn('Failed to record API metric', { err: err.message })
    );

    return originalJson(body);
  };

  next();
};

module.exports = metricsMiddleware;
