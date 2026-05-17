import crypto from 'node:crypto';
import type { AppConfig } from '../../config/env.js';

const KEY_ID_BYTES = 12;
const SECRET_BYTES = 32;

function keyPepper(config: AppConfig): string {
  return config.API_KEY_PEPPER ?? config.SESSION_SECRET ?? 'development-only-api-key-pepper-change-before-production';
}

function keyEnvironment(config: AppConfig): 'live' | 'dev' {
  return config.NODE_ENV === 'production' ? 'live' : 'dev';
}

export function hashAppApiKey(rawKey: string, config: AppConfig): string {
  return crypto.createHmac('sha256', keyPepper(config)).update(rawKey).digest('hex');
}

export function generateAppApiKey(config: AppConfig) {
  const keyId = crypto.randomBytes(KEY_ID_BYTES).toString('base64url');
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  const keyPrefix = `egw_${keyEnvironment(config)}_${keyId}`;
  const rawKey = `${keyPrefix}_${secret}`;

  return {
    rawKey,
    keyPrefix,
    keyHash: hashAppApiKey(rawKey, config)
  };
}

export function extractKeyPrefix(rawKey: string): string | null {
  const parts = rawKey.split('_');
  if (parts.length !== 4 || parts[0] !== 'egw' || !['dev', 'live'].includes(parts[1]!)) {
    return null;
  }

  return parts.slice(0, 3).join('_');
}

export function safeCompareHashes(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
