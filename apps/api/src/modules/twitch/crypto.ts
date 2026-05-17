import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { AppConfig } from '../../config/env.js';

const algorithm = 'aes-256-gcm';

function keyFromConfig(config: AppConfig): Buffer {
  if (!config.TOKEN_ENCRYPTION_KEY) {
    throw new Error('TOKEN_ENCRYPTION_KEY is required for Twitch token encryption');
  }

  const raw = config.TOKEN_ENCRYPTION_KEY;
  const decoded = /^[A-Za-z0-9+/]+=*$/.test(raw) ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (decoded.length === 32) return decoded;

  const hex = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.alloc(0);
  if (hex.length === 32) return hex;

  const utf8 = Buffer.from(raw, 'utf8');
  if (utf8.length === 32) return utf8;

  throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes as utf8, base64, or hex');
}

export function encryptSecret(value: string, config: AppConfig) {
  const key = keyFromConfig(config);
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptSecret(envelope: string, config: AppConfig) {
  const [version, iv, tag, ciphertext] = envelope.split(':');
  if (version !== 'v1' || !iv || !tag || !ciphertext) {
    throw new Error('Invalid encrypted token envelope');
  }

  const decipher = createDecipheriv(algorithm, keyFromConfig(config), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}
