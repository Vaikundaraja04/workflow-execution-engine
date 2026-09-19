import { SessionService, parseUserAgent, hashToken } from '../src/services/sessionService.js';
import { UserSessionModel } from '../src/models/UserSessionModel.js';
import { createAuditLog } from '../src/services/auditService.js';
import { Types } from 'mongoose';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';

// Mock the models and service
vi.mock('../src/models/UserSessionModel.js');
vi.mock('../src/services/auditService.js');

describe('SessionService', () => {
  const sessionService = new SessionService();
  const mockUserId = new Types.ObjectId().toString();
  const mockWorkspaceId = new Types.ObjectId().toString();
  const mockRefreshToken = 'mock-refresh-token';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseUserAgent', () => {
    it('should return default values for undefined userAgent', () => {
      const result = parseUserAgent(undefined);
      expect(result).toEqual({
        browser: 'Unknown Browser',
        os: 'Unknown OS',
        deviceType: 'UNKNOWN',
      });
    });

    it('should detect mobile device', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36';
      const result = parseUserAgent(ua);
      expect(result.deviceType).toBe('MOBILE');
      expect(result.os).toBe('Android');
      expect(result.browser).toBe('Chrome');
    });

    it('should detect tablet device', () => {
      const ua = 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1';
      const result = parseUserAgent(ua);
      expect(result.deviceType).toBe('TABLET');
      expect(result.os).toBe('iOS');
      expect(result.browser).toBe('Safari');
    });

    it('should detect desktop device', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
      const result = parseUserAgent(ua);
      expect(result.deviceType).toBe('DESKTOP');
      expect(result.os).toBe('Windows');
      expect(result.browser).toBe('Chrome');
    });
  });

  describe('hashToken', () => {
    it('should hash a token using SHA-256', () => {
      const token = 'test-token';
      const hash = hashToken(token);
      expect(hash).toBe(
        crypto
          .createHash('sha256')
          .update(token)
          .digest('hex')
      );
    });
  });

  describe('createSession', () => {
    it('should create a new session and log audit', async () => {
      const chromeUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
      const mockSession = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(mockUserId),
        workspaceId: new Types.ObjectId(mockWorkspaceId),
        sessionTokenHash: 'hashed-token',
        ipAddress: '192.168.1.1',
        userAgent: chromeUa,
        browser: 'Chrome',
        os: 'Windows',
        deviceType: 'DESKTOP',
        isRevoked: false,
        lastActiveAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (UserSessionModel.create as any).mockResolvedValue(mockSession);
      (createAuditLog as any).mockResolvedValue(undefined);

      const result = await sessionService.createSession(
        mockUserId,
        mockRefreshToken,
        '192.168.1.1',
        chromeUa,
        mockWorkspaceId
      );

      expect(UserSessionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.any(Object),
          workspaceId: expect.any(Object),
          sessionTokenHash: expect.any(String),
          ipAddress: '192.168.1.1',
          userAgent: chromeUa,
          browser: 'Chrome',
          os: 'Windows',
          deviceType: 'DESKTOP',
          isRevoked: false,
        })
      );
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SESSION_CREATED',
          userId: mockUserId,
          workspaceId: mockWorkspaceId,
          resource: 'UserSession',
          resourceId: mockSession._id.toString(),
        })
      );
      expect(result).toMatchObject(mockSession);
    });
  });

  describe('getUserSessions', () => {
    it('should return active, non-revoked sessions for a user', async () => {
      const mockSessions = [
        {
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(mockUserId),
          workspaceId: new Types.ObjectId(mockWorkspaceId),
          sessionTokenHash: 'hash1',
          ipAddress: '192.168.1.1',
          userAgent: 'agent1',
          browser: 'Chrome',
          os: 'Windows',
          deviceType: 'DESKTOP',
          isRevoked: false,
          lastActiveAt: new Date(Date.now() - 1000),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(mockUserId),
          workspaceId: new Types.ObjectId(mockWorkspaceId),
          sessionTokenHash: 'hash2',
          ipAddress: '192.168.1.2',
          userAgent: 'agent2',
          browser: 'Firefox',
          os: 'macOS',
          deviceType: 'DESKTOP',
          isRevoked: false,
          lastActiveAt: new Date(Date.now() - 2000),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      (UserSessionModel.find as any).mockReturnValue({
        sort: vi.fn().mockResolvedValue(mockSessions),
      });

      const result = await sessionService.getUserSessions(mockUserId);

      expect(UserSessionModel.find).toHaveBeenCalledWith({
        userId: expect.any(Object),
        isRevoked: false,
        expiresAt: { $gt: expect.any(Date) },
      });
      expect(result).toHaveLength(2);
      expect(result[0]?.browser).toBe('Chrome');
      expect(result[1]?.browser).toBe('Firefox');
    });
  });

  describe('revokeSession', () => {
    it('should revoke a session and log audit', async () => {
      const sessionId = new Types.ObjectId();
      const revokedByUserId = new Types.ObjectId();
      const mockSession = {
        _id: sessionId,
        userId: new Types.ObjectId(mockUserId),
        workspaceId: new Types.ObjectId(mockWorkspaceId),
        tokenHash: 'hash',
        ipAddress: '192.168.1.1',
        userAgent: 'test-agent',
        browser: 'Chrome',
        os: 'Windows',
        deviceType: 'DESKTOP',
        isRevoked: false,
        lastActiveAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (UserSessionModel.findByIdAndUpdate as any).mockResolvedValue({
        ...mockSession,
        isRevoked: true,
        revokedAt: new Date(),
        revokedReason: 'User initiated logout',
        revokedBy: revokedByUserId,
      });
      (createAuditLog as any).mockResolvedValue(undefined);

      const result = await sessionService.revokeSession(
        sessionId.toString(),
        revokedByUserId.toString(),
        'User initiated logout'
      );

      expect(UserSessionModel.findByIdAndUpdate).toHaveBeenCalledWith(
        sessionId.toString(),
        {
          isRevoked: true,
          revokedAt: expect.any(Date),
          revokedReason: 'User initiated logout',
        },
        { new: true }
      );
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SESSION_REVOKED',
          userId: revokedByUserId.toString(),
          resource: 'UserSession',
          resourceId: sessionId.toString(),
          metadata: { reason: 'User initiated logout' },
        })
      );
      expect(result?.isRevoked).toBe(true);
      expect(result?.revokedReason).toBe('User initiated logout');
    });

    it('should return null if session not found', async () => {
      (UserSessionModel.findByIdAndUpdate as any).mockResolvedValue(null);

      const result = await sessionService.revokeSession(
        new Types.ObjectId().toString(),
        new Types.ObjectId().toString(),
        'Reason'
      );

      expect(result).toBeNull();
    });
  });

  describe('revokeAllOtherSessions', () => {
    it('should revoke all other sessions except the current one', async () => {
      const currentRefreshToken = 'current-token';
      const currentHash = hashToken(currentRefreshToken);

      const mockResult = { modifiedCount: 3 };
      (UserSessionModel.updateMany as any).mockResolvedValue(mockResult);
      (createAuditLog as any).mockResolvedValue(undefined);

      const count = await sessionService.revokeAllOtherSessions(
        mockUserId,
        currentRefreshToken,
        'Revoked other active sessions'
      );

      expect(UserSessionModel.updateMany).toHaveBeenCalledWith(
        {
          userId: expect.any(Object),
          sessionTokenHash: { $ne: currentHash },
          isRevoked: false,
        },
        {
          isRevoked: true,
          revokedAt: expect.any(Date),
          revokedReason: 'Revoked other active sessions',
        }
      );
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SESSION_REVOKED',
          userId: mockUserId,
          resource: 'UserSession',
          metadata: { reason: 'Revoked other active sessions', count: 3 },
        })
      );
      expect(count).toBe(3);
    });
  });

  describe('touchSession', () => {
    it('should update the last active timestamp of a session', async () => {
      const sessionTokenHash = hashToken(mockRefreshToken);
      (UserSessionModel.updateOne as any).mockResolvedValue({ modifiedCount: 1 });

      await sessionService.touchSession(mockRefreshToken);

      expect(UserSessionModel.updateOne).toHaveBeenCalledWith(
        { sessionTokenHash, isRevoked: false },
        { lastActiveAt: expect.any(Date) }
      );
    });
  });

  describe('isSessionValid', () => {
    it('should return true for a valid, non-revoked session', async () => {
      const sessionTokenHash = hashToken(mockRefreshToken);
      const mockSession = {
        _id: new Types.ObjectId(),
        sessionTokenHash,
        isRevoked: false,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
      (UserSessionModel.findOne as any).mockResolvedValue(mockSession);

      const isValid = await sessionService.isSessionValid(mockRefreshToken);

      expect(UserSessionModel.findOne).toHaveBeenCalledWith({
        sessionTokenHash,
        isRevoked: false,
        expiresAt: { $gt: expect.any(Date) },
      });
      expect(isValid).toBe(true);
    });

    it('should return false for an expired session', async () => {
      const sessionTokenHash = hashToken(mockRefreshToken);
      (UserSessionModel.findOne as any).mockResolvedValue(null);

      const isValid = await sessionService.isSessionValid(mockRefreshToken);

      expect(isValid).toBe(false);
    });
  });
});