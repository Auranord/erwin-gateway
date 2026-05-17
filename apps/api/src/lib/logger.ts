import pino from 'pino';
import type { AppConfig } from '../config/env.js';
import { secretRedactionPaths } from '../config/redaction.js';

export function createLogger(config: AppConfig) {
  return pino({
    name: 'erwin-gateway',
    level: config.LOG_LEVEL,
    redact: {
      paths: secretRedactionPaths,
      censor: '[REDACTED]'
    },
    base: {
      service: 'erwin-gateway',
      version: process.env.npm_package_version ?? '0.1.0'
    }
  });
}
