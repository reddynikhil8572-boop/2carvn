import crypto from 'node:crypto';
import { config } from '../config/env';

/**
 * Authenticated symmetric encryption for secrets the application must be able
 * to read back — currently TOTP seeds.
 *
 * AES-256-GCM rather than CBC: GCM authenticates the ciphertext, so a row
 * tampered with in the database fails to decrypt instead of yielding a
 * plausible-looking wrong secret. Passwords are hashed, not encrypted; this is
 * only for values that have to be recovered in plaintext to be useful.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, the GCM standard nonce size
const KEY_BYTES = 32;
const VERSION = 'v1'; // lets a future key rotation identify what a row was sealed with

let cachedKey: Buffer | null = null;

/**
 * Resolved lazily rather than at module load so that importing anything in this
 * tree does not require the key to be present — only actually encrypting does.
 */
const key = (): Buffer => {
  if (cachedKey) return cachedKey;

  const raw = config.encryptionKey;
  if (!raw) {
    throw new Error(
      'FATAL: ENCRYPTION_KEY is required to store two-factor secrets. ' +
        'Generate one with: openssl rand -base64 32'
    );
  }

  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `FATAL: ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${decoded.length}. ` +
        'Generate one with: openssl rand -base64 32'
    );
  }

  cachedKey = decoded;
  return decoded;
};

/** Encodes as `v1.<iv>.<authTag>.<ciphertext>`, all base64url. */
export const encryptSecret = (plaintext: string): string => {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
};

export const decryptSecret = (sealed: string): string => {
  const [version, ivPart, tagPart, dataPart] = sealed.split('.');

  if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error('Malformed encrypted value');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  // Throws on a wrong key or altered ciphertext rather than returning garbage.
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};

/** True when a key is configured, so callers can fail with a clear message. */
export const encryptionAvailable = (): boolean => Boolean(config.encryptionKey);
