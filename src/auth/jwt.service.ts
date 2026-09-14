import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

export interface AuthConfig {
  jwtSecret: string;
  accessTtl: string;
  refreshTtl: string;
}

export interface AccessTokenPayload {
  userId: string;
  email: string;
}

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDurationMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match || !match[1] || !match[2]) throw new Error('INVALID_AUTH_TTL');
  const factor = DURATION_UNITS[match[2]];
  if (!factor) throw new Error('INVALID_AUTH_TTL');
  return Number(match[1]) * factor;
}

export function signAccessToken(config: AuthConfig, payload: AccessTokenPayload): string {
  return jwt.sign(
    { userId: payload.userId, email: payload.email },
    config.jwtSecret,
    { algorithm: 'HS256', expiresIn: Math.floor(parseDurationMs(config.accessTtl) / 1000) },
  );
}

export function verifyAccessToken(config: AuthConfig, token: string): AccessTokenPayload {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch (error) {
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      throw new Error('TOKEN_EXPIRED');
    }
    throw new Error('INVALID_TOKEN');
  }
  if (typeof decoded !== 'object' || decoded === null) throw new Error('INVALID_TOKEN');
  const payload = decoded as { userId?: unknown; email?: unknown };
  if (typeof payload.userId !== 'string' || typeof payload.email !== 'string') {
    throw new Error('INVALID_TOKEN');
  }
  return { userId: payload.userId, email: payload.email };
}

export function createRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}