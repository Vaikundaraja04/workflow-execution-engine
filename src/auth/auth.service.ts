import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { UserModel } from '../models/UserModel.js';
import type { IUser } from '../models/UserModel.js';
import { RefreshTokenModel } from '../models/RefreshTokenModel.js';
import { hashPassword, verifyPassword } from './password.service.js';
import {
  createRefreshToken,
  hashRefreshToken,
  parseDurationMs,
  signAccessToken,
} from './jwt.service.js';
import type { AuthConfig } from './jwt.service.js';
import { createAuditLog } from '../services/auditService.js';

export interface UserView {
  id: string;
  email: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SessionContext {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

export function toUserView(user: IUser): UserView {
  return { id: user._id.toString(), email: user.email };
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 11000;
}

let dummyPasswordHash: Promise<string> | undefined;

function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= hashPassword('timing-equalization-placeholder');
  return dummyPasswordHash;
}

export async function registerUser(email: string, password: string): Promise<IUser> {
  const passwordHash = await hashPassword(password);
  try {
    return await UserModel.create({ email, passwordHash });
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new Error('EMAIL_TAKEN');
    throw error;
  }
}

export async function loginUser(email: string, password: string): Promise<IUser> {
  const user = await UserModel.findOne({ email }).select('+passwordHash');
  if (!user) {
    await verifyPassword(await getDummyPasswordHash(), password);
    throw new Error('INVALID_CREDENTIALS');
  }
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) throw new Error('INVALID_CREDENTIALS');
  return user;
}

async function storeRefreshToken(
  config: AuthConfig,
  userId: Types.ObjectId,
  familyId: string,
  context: SessionContext = {},
): Promise<string> {
  const refreshToken = createRefreshToken();
  const doc: {
    userId: Types.ObjectId;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
    revoked: boolean;
    lastUsedAt: Date;
    userAgent?: string;
    ipAddress?: string;
  } = {
    userId,
    tokenHash: hashRefreshToken(refreshToken),
    familyId,
    expiresAt: new Date(Date.now() + parseDurationMs(config.refreshTtl)),
    revoked: false,
    lastUsedAt: new Date(),
  };
  if (context.userAgent) doc.userAgent = context.userAgent;
  if (context.ipAddress) doc.ipAddress = context.ipAddress;
  await RefreshTokenModel.create(doc);
  return refreshToken;
}

export async function issueTokens(
  config: AuthConfig,
  userId: Types.ObjectId,
  email: string,
  context: SessionContext = {},
): Promise<IssuedTokens> {
  const familyId = randomUUID();
  const accessToken = signAccessToken(config, { userId: userId.toString(), email, sessionId: familyId });
  const refreshToken = await storeRefreshToken(config, userId, familyId, context);
  return { accessToken, refreshToken };
}

export async function rotateRefreshToken(
  config: AuthConfig,
  presentedToken: string,
  context: SessionContext = {},
): Promise<IssuedTokens> {
  const stored = await RefreshTokenModel.findOne({ tokenHash: hashRefreshToken(presentedToken) });
  if (!stored) throw new Error('INVALID_REFRESH_TOKEN');

  if (stored.revoked) {
    await RefreshTokenModel.updateMany(
      { familyId: stored.familyId, revoked: false },
      { $set: { revoked: true } },
    );
    await createAuditLog({
      action: 'AUTH_REFRESH_REPLAY',
      userId: stored.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    throw new Error('INVALID_REFRESH_TOKEN');
  }

  if (stored.expiresAt.getTime() <= Date.now()) throw new Error('INVALID_REFRESH_TOKEN');

  stored.revoked = true;
  stored.lastUsedAt = new Date();
  await stored.save();

  const user = await UserModel.findById(stored.userId);
  if (!user) throw new Error('INVALID_REFRESH_TOKEN');

  const accessToken = signAccessToken(config, { userId: user._id.toString(), email: user.email, sessionId: stored.familyId });
  const refreshToken = await storeRefreshToken(config, stored.userId, stored.familyId, context);
  await createAuditLog({
    action: 'AUTH_REFRESH',
    userId: stored.userId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
  return { accessToken, refreshToken };
}

export async function revokeRefreshTokenFamily(
  presentedToken: string,
): Promise<{ userId: Types.ObjectId; familyId: string } | null> {
  const stored = await RefreshTokenModel.findOne({ tokenHash: hashRefreshToken(presentedToken) });
  if (!stored) return null;
  await RefreshTokenModel.updateMany(
    { familyId: stored.familyId, revoked: false },
    { $set: { revoked: true } },
  );
  return { userId: stored.userId, familyId: stored.familyId };
}

export interface UserSessionView {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export async function listUserSessions(
  userId: string,
  currentSessionId?: string,
): Promise<UserSessionView[]> {
  const tokens = await RefreshTokenModel.find({
    userId: new Types.ObjectId(userId),
    revoked: false,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: 1 });

  const sessions = new Map<string, { id: string; createdAt: Date; lastUsedAt: Date; expiresAt: Date }>();
  for (const token of tokens) {
    const lastUsedAt = token.lastUsedAt ?? token.createdAt;
    const existing = sessions.get(token.familyId);
    if (!existing) {
      sessions.set(token.familyId, {
        id: token.familyId,
        createdAt: token.createdAt,
        lastUsedAt,
        expiresAt: token.expiresAt,
      });
      continue;
    }
    if (lastUsedAt > existing.lastUsedAt) existing.lastUsedAt = lastUsedAt;
    if (token.expiresAt > existing.expiresAt) existing.expiresAt = token.expiresAt;
  }

  return [...sessions.values()]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .map(session => ({
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      current: session.id === currentSessionId,
    }));
}

export async function revokeSessionFamily(userId: string, familyId: string): Promise<boolean> {
  const userObjectId = new Types.ObjectId(userId);
  const existing = await RefreshTokenModel.exists({ userId: userObjectId, familyId });
  if (!existing) return false;
  await RefreshTokenModel.updateMany(
    { userId: userObjectId, familyId, revoked: false },
    { $set: { revoked: true } },
  );
  return true;
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await RefreshTokenModel.updateMany(
    { userId: new Types.ObjectId(userId), revoked: false },
    { $set: { revoked: true } },
  );
  return result.modifiedCount;
}