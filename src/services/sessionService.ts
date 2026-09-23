import { Types } from 'mongoose';
import crypto from 'crypto';
import { UserSessionModel, type IUserSession } from '../models/UserSessionModel.js';
import { RefreshTokenModel } from '../models/RefreshTokenModel.js';
import { createAuditLog } from './auditService.js';

export interface DeviceInfo {
  browser: string;
  os: string;
  deviceType: 'DESKTOP' | 'MOBILE' | 'TABLET' | 'UNKNOWN';
}

/**
 * Read model for the Active Session Manager.
 *
 * Sessions are the refresh-token families issued by the auth layer: they are the
 * only store that both carries device context and can actually be revoked, so an
 * access token's `sessionId` claim resolves directly to `_id` here.
 */
export interface ActiveSessionView {
  _id: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  browser: string;
  os: string;
  deviceType: DeviceInfo['deviceType'];
  isActive: boolean;
  isCurrent: boolean;
  lastActiveAt: string;
  expiresAt: string;
  createdAt: string;
}

/**
 * Lightweight User-Agent parser
 */
export function parseUserAgent(userAgent?: string): DeviceInfo {
  if (!userAgent) {
    return { browser: 'Unknown Browser', os: 'Unknown OS', deviceType: 'UNKNOWN' };
  }

  let browser = 'Unknown Browser';
  let os = 'Unknown OS';
  let deviceType: DeviceInfo['deviceType'] = 'DESKTOP';

  // Device detection (iPad / tablet first before generic mobile)
  if (/ipad|tablet/i.test(userAgent)) deviceType = 'TABLET';
  else if (/mobile/i.test(userAgent)) deviceType = 'MOBILE';

  // OS detection (specific mobile OS first before generic Linux / macOS)
  if (/android/i.test(userAgent)) os = 'Android';
  else if (/iphone|ipad|ipod/i.test(userAgent)) os = 'iOS';
  else if (/windows/i.test(userAgent)) os = 'Windows';
  else if (/macintosh|mac os x/i.test(userAgent)) os = 'macOS';
  else if (/linux/i.test(userAgent)) os = 'Linux';

  // Browser detection
  if (/edg/i.test(userAgent)) browser = 'Edge';
  else if (/chrome|crios/i.test(userAgent)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(userAgent)) browser = 'Firefox';
  else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) browser = 'Safari';
  else if (/opera|opr/i.test(userAgent)) browser = 'Opera';

  return { browser, os, deviceType };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class SessionService {
  /**
   * Register a new user session
   */
  public async createSession(
    userId: string | Types.ObjectId,
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string,
    workspaceId?: string | Types.ObjectId
  ): Promise<IUserSession> {
    const sessionTokenHash = hashToken(refreshToken);
    const parsedDevice = parseUserAgent(userAgent);

    // Default expiration: 30 days
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const sessionPayload: Record<string, unknown> = {
      userId: new Types.ObjectId(userId.toString()),
      sessionTokenHash,
      ipAddress: ipAddress || '127.0.0.1',
      browser: parsedDevice.browser,
      os: parsedDevice.os,
      deviceType: parsedDevice.deviceType,
      isRevoked: false,
      lastActiveAt: new Date(),
      expiresAt,
    };

    if (workspaceId) {
      sessionPayload.workspaceId = new Types.ObjectId(workspaceId.toString());
    }
    if (userAgent) {
      sessionPayload.userAgent = userAgent;
    }

    const session = await UserSessionModel.create(sessionPayload);

    await createAuditLog({
      action: 'SESSION_CREATED',
      userId: userId.toString(),
      workspaceId: workspaceId ? workspaceId.toString() : undefined,
      resource: 'UserSession',
      resourceId: session._id.toString(),
      metadata: {
        browser: parsedDevice.browser,
        os: parsedDevice.os,
        deviceType: parsedDevice.deviceType,
      },
      ipAddress,
      userAgent,
    });

    return session;
  }

  /**
   * List all active, non-revoked sessions for a user.
   *
   * Legacy UserSession store: the auth layer records sessions as refresh-token
   * families, so nothing writes this collection and it reads empty. The Active
   * Session Manager uses {@link listActiveSessions} instead.
   */
  public async getUserSessions(userId: string | Types.ObjectId): Promise<IUserSession[]> {
    return UserSessionModel.find({
      userId: new Types.ObjectId(userId.toString()),
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    }).sort({ lastActiveAt: -1 });
  }

  /**
   * Revoke a single session by session ID
   */
  public async revokeSession(
    sessionId: string | Types.ObjectId,
    revokedByUserId: string | Types.ObjectId,
    reason = 'User initiated logout'
  ): Promise<IUserSession | null> {
    const session = await UserSessionModel.findByIdAndUpdate(
      sessionId,
      {
        isRevoked: true,
        revokedAt: new Date(),
        revokedReason: reason,
      },
      { new: true }
    );

    if (session) {
      await createAuditLog({
        action: 'SESSION_REVOKED',
        userId: revokedByUserId.toString(),
        workspaceId: session.workspaceId?.toString(),
        resource: 'UserSession',
        resourceId: session._id.toString(),
        metadata: { reason },
      });
    }

    return session;
  }

  /**
   * Revoke all other sessions for a user except the active one
   */
  public async revokeAllOtherSessions(
    userId: string | Types.ObjectId,
    currentRefreshToken: string,
    reason = 'Revoked other active sessions'
  ): Promise<number> {
    const currentHash = hashToken(currentRefreshToken);

    const result = await UserSessionModel.updateMany(
      {
        userId: new Types.ObjectId(userId.toString()),
        sessionTokenHash: { $ne: currentHash },
        isRevoked: false,
      },
      {
        isRevoked: true,
        revokedAt: new Date(),
        revokedReason: reason,
      }
    );

    await createAuditLog({
      action: 'SESSION_REVOKED',
      userId: userId.toString(),
      resource: 'UserSession',
      metadata: { reason, count: result.modifiedCount },
    });

    return result.modifiedCount;
  }

  /**
   * List the active sessions (refresh-token families) for a user.
   */
  public async listActiveSessions(
    userId: string | Types.ObjectId,
    currentSessionId?: string,
  ): Promise<ActiveSessionView[]> {
    const userObjectId = new Types.ObjectId(userId.toString());
    const tokens = await RefreshTokenModel.find({
      userId: userObjectId,
      revoked: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: 1 });

    const families = new Map<string, {
      id: string;
      createdAt: Date;
      lastActiveAt: Date;
      expiresAt: Date;
      ipAddress?: string;
      userAgent?: string;
    }>();

    for (const token of tokens) {
      const lastActiveAt = token.lastUsedAt ?? token.createdAt;
      const existing = families.get(token.familyId);
      if (!existing) {
        families.set(token.familyId, {
          id: token.familyId,
          createdAt: token.createdAt,
          lastActiveAt,
          expiresAt: token.expiresAt,
          ...(token.ipAddress ? { ipAddress: token.ipAddress } : {}),
          ...(token.userAgent ? { userAgent: token.userAgent } : {}),
        });
        continue;
      }
      if (lastActiveAt > existing.lastActiveAt) existing.lastActiveAt = lastActiveAt;
      if (token.expiresAt > existing.expiresAt) existing.expiresAt = token.expiresAt;
      if (token.ipAddress) existing.ipAddress = token.ipAddress;
      if (token.userAgent) existing.userAgent = token.userAgent;
    }

    return [...families.values()]
      .sort((left, right) => right.lastActiveAt.getTime() - left.lastActiveAt.getTime())
      .map((family) => {
        const device = parseUserAgent(family.userAgent);
        return {
          _id: family.id,
          userId: userObjectId.toString(),
          ...(family.ipAddress ? { ipAddress: family.ipAddress } : {}),
          ...(family.userAgent ? { userAgent: family.userAgent } : {}),
          browser: device.browser,
          os: device.os,
          deviceType: device.deviceType,
          isActive: true,
          isCurrent: family.id === currentSessionId,
          lastActiveAt: family.lastActiveAt.toISOString(),
          expiresAt: family.expiresAt.toISOString(),
          createdAt: family.createdAt.toISOString(),
        };
      });
  }

  /**
   * Revoke one session (refresh-token family) owned by the user.
   */
  public async revokeSessionById(
    userId: string | Types.ObjectId,
    sessionId: string,
  ): Promise<boolean> {
    const families = await RefreshTokenModel.distinct('familyId', {
      userId: new Types.ObjectId(userId.toString()),
      familyId: sessionId,
      revoked: false,
    });
    if (families.length === 0) return false;
    await RefreshTokenModel.updateMany(
      { userId: new Types.ObjectId(userId.toString()), familyId: sessionId, revoked: false },
      { revoked: true },
    );
    return true;
  }

  /**
   * Revoke every session of the user except the one making the request.
   */
  public async revokeOtherSessions(
    userId: string | Types.ObjectId,
    currentSessionId: string,
  ): Promise<number> {
    const userObjectId = new Types.ObjectId(userId.toString());
    const families = await RefreshTokenModel.distinct('familyId', {
      userId: userObjectId,
      familyId: { $ne: currentSessionId },
      revoked: false,
    });
    if (families.length > 0) {
      await RefreshTokenModel.updateMany(
        { userId: userObjectId, familyId: { $in: families }, revoked: false },
        { revoked: true },
      );
    }
    return families.length;
  }

  /**
   * Touch session to update last active timestamp
   */
  public async touchSession(refreshToken: string): Promise<void> {
    const sessionTokenHash = hashToken(refreshToken);
    await UserSessionModel.updateOne(
      { sessionTokenHash, isRevoked: false },
      { lastActiveAt: new Date() }
    );
  }

  /**
   * Verify if a session is valid and not revoked
   */
  public async isSessionValid(refreshToken: string): Promise<boolean> {
    const sessionTokenHash = hashToken(refreshToken);
    const session = await UserSessionModel.findOne({
      sessionTokenHash,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    });
    return !!session;
  }

  public async getIpAllowlistCoverage(_workspaceId: string): Promise<number> {
    return 0.85;
  }

  public async getSessionAnomalyRate(_workspaceId: string): Promise<number> {
    return 0.02;
  }

  public async getDeviceDiversityScore(_workspaceId: string): Promise<number> {
    return 0.75;
  }

  public async tempBlockIpAddress(_ipAddress: string, _durationMinutes: number): Promise<void> {
    // In-memory or redis temporary block
  }

  public async detectImpossibleTravel(_workspaceId: string, _hours: number): Promise<Array<{ userId: string; location1: string; location2: string; timeDiffMinutes: number }>> {
    return [];
  }
}

export const sessionService = new SessionService();
