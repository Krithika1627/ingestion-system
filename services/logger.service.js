/**
 * Structured Winston logger with JSON output, timestamps, and log file transports.
 * Redacts sensitive fields to avoid credential leakage.
 */
const fs = require('fs');
const path = require('path');
const winston = require('winston');

const LOG_DIR = path.join(__dirname, '..', 'logs');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const SENSITIVE_KEY_REGEX = /token|authorization|password|secret|api[-_]?key/i;
const REDACTION = '[REDACTED]';

function scrubInPlace(value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => scrubInPlace(entry));
    return;
  }

  if (value && typeof value === 'object') {
    Object.keys(value).forEach((key) => {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        value[key] = REDACTION;
      } else {
        scrubInPlace(value[key]);
      }
    });
  }
}

const redactSensitive = winston.format((info) => {
  scrubInPlace(info);
  return info;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    redactSensitive(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(LOG_DIR, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(LOG_DIR, 'combined.log') })
  ]
});

module.exports = logger;