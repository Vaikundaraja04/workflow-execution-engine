import crypto from 'crypto';
import type { IWorkspaceSecurityPolicy } from '../models/WorkspaceSecurityPolicyModel.js';

export interface MfaSetupResult {
  secret: string;
  otpauthUrl: string;
  backupCodes: string[];
}

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Base32 encode helper for TOTP secrets
 */
function base32Encode(buffer: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i] ?? 0;
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Base32 decode helper for TOTP secrets
 */
function base32Decode(encoded: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleanStr = encoded.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleanStr.length; i++) {
    const ch = cleanStr[i] ?? '';
    const val = alphabet.indexOf(ch);
    if (val === -1) continue;

    value = (value << 5) | val;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generate 6-digit TOTP code for a secret at a given timestamp
 */
export function generateTotpCode(secret: string, timestamp: number = Date.now(), timeStepSeconds: number = 30): string {
  const key = base32Decode(secret);
  const counter = Math.floor(timestamp / 1000 / timeStepSeconds);

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const lastByte = hmac[hmac.length - 1] ?? 0;
  const offset = lastByte & 0xf;
  const b0 = hmac[offset] ?? 0;
  const b1 = hmac[offset + 1] ?? 0;
  const b2 = hmac[offset + 2] ?? 0;
  const b3 = hmac[offset + 3] ?? 0;
  const codeInt =
    ((b0 & 0x7f) << 24) |
    ((b1 & 0xff) << 16) |
    ((b2 & 0xff) << 8) |
    (b3 & 0xff);

  const code = (codeInt % 1_000_000).toString().padStart(6, '0');
  return code;
}

/**
 * Verify a 6-digit TOTP code with time drift window tolerance
 */
export function verifyTotpCode(secret: string, code: string, windowSteps: number = 1): boolean {
  const now = Date.now();
  const timeStep = 30;

  for (let i = -windowSteps; i <= windowSteps; i++) {
    const checkTime = now + i * timeStep * 1000;
    const expected = generateTotpCode(secret, checkTime, timeStep);
    if (crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

export class MfaService {
  /**
   * Scaffolds MFA TOTP secret, otpauth URL, and backup codes for a user
   */
  public generateMfaSetup(userEmail: string, issuer = 'WorkflowEngine'): MfaSetupResult {
    const randomBytes = crypto.randomBytes(20);
    const secret = base32Encode(randomBytes);
    const encodedIssuer = encodeURIComponent(issuer);
    const encodedEmail = encodeURIComponent(userEmail);

    const otpauthUrl = `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;

    // Generate 8 8-character hex backup codes
    const backupCodes: string[] = [];
    for (let i = 0; i < 8; i++) {
      backupCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }

    return { secret, otpauthUrl, backupCodes };
  }

  /**
   * Verify TOTP token
   */
  public verifyToken(secret: string, token: string): boolean {
    if (!token || token.length !== 6) return false;
    return verifyTotpCode(secret, token);
  }

  /**
   * Validate password compliance against workspace password policies
   */
  public validatePasswordPolicy(
    password: string,
    policy?: Partial<IWorkspaceSecurityPolicy>
  ): PasswordValidationResult {
    const errors: string[] = [];
    const minLength = policy?.passwordMinLength ?? 12;
    const requireUppercase = policy?.passwordRequireUppercase ?? true;
    const requireNumbers = policy?.passwordRequireNumbers ?? true;
    const requireSymbols = policy?.passwordRequireSymbols ?? true;

    if (!password || password.length < minLength) {
      errors.push(`Password must be at least ${minLength} characters long`);
    }
    if (requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    if (requireNumbers && !/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    if (requireSymbols && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
      errors.push('Password must contain at least one special symbol');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

export const mfaService = new MfaService();
