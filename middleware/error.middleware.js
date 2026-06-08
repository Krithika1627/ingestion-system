const logger = require('../services/logger.service');

// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal server error';

  logger.error({
    message: 'Unhandled route error',
    method: req?.method || 'unknown',
    path: req?.originalUrl || req?.url || 'unknown',
    query: req?.query || {},
    statusCode,
    error: message,
    stack: err?.stack || null
  });

  res.status(statusCode).json({
    success: false,
    error: message,
    code: statusCode
  });
}

module.exports = errorMiddleware;
