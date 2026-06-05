/**
 * Global error-handling middleware.
 *
 * Must be registered LAST in the middleware chain.
 * Catches any unhandled errors thrown in route handlers and returns
 * a consistent error envelope. Never exposes stack traces in responses.
 */
const logger = require('../services/logger.service');

/**
 * Express error-handling middleware (4-arg signature).
 * Logs the error and returns a sanitized JSON envelope.
 *
 * @param {Error}   err
 * @param {object}  req  — Express request
 * @param {object}  res  — Express response
 * @param {function} next — Express next (required for error middleware signature)
 */
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
