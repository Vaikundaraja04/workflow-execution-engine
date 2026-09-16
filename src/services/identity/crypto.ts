import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface EncryptionResult {
  encryptedData: string;
  iv: string;
  tag: string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM

function getEncryptionKey(): Buffer {
  const secret = process.env.IDP_SECRET_KEY || process.env.WEBHOOK_SECRET_KEY || 'default-secret-key-32-chars-long!!';
  return createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a plaintext secret using AES-256-GCM.
 */
export function encryptIdpSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${encrypted.toString('base64')}.${iv.toString('base64')}.${tag.toString('base64')}`;
}

/**
 * Decrypt an AES-256-GCM encrypted secret.
 */
export function decryptIdpSecret(encryptedString: string): string {
  const [encryptedData, iv, tag] = encryptedString.split('.');
  if (!encryptedData || !iv || !tag) {
    throw new Error('IDP_SECRET_CORRUPTED');
  }

  const key = getEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(encryptedData, 'base64'),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * Hash a SCIM bearer token using SHA-256.
 */
export function hashSCIMToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a new random SCIM bearer token.
 * Returns both the raw token (to show user once) and its prefix + hash.
 */
export function generateSCIMToken(): { rawToken: string; prefix: string; tokenHash: string } {
  const rawToken = `scim_${randomBytes(24).toString('base64url')}`;
  const prefix = rawToken.slice(0, 10);
  const tokenHash = hashSCIMToken(rawToken);
  return { rawToken, prefix, tokenHash };
}
