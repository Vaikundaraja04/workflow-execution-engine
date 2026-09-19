/// <reference types="vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PrivacyService,
  maskEmail,
  maskIpAddress,
  maskPII,
} from '../src/services/privacyService.js';
import { PrivacyRequestModel } from '../src/models/PrivacyRequestModel.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { WorkflowCommentModel } from '../src/models/WorkflowCommentModel.js';
import { NotificationModel } from '../src/models/NotificationModel.js';
import { UserSessionModel } from '../src/models/UserSessionModel.js';
import { RefreshTokenModel } from '../src/models/RefreshTokenModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { createAuditLog } from '../src/services/auditService.js';
import { Types } from 'mongoose';

// Mock all Mongoose models
vi.mock('../src/models/PrivacyRequestModel.js');
vi.mock('../src/models/UserModel.js');
vi.mock('../src/models/WorkflowModel.js');
vi.mock('../src/models/WorkflowExecutionModel.js');
vi.mock('../src/models/WorkflowCommentModel.js');
vi.mock('../src/models/NotificationModel.js');
vi.mock('../src/models/UserSessionModel.js');
vi.mock('../src/models/RefreshTokenModel.js');
vi.mock('../src/models/WorkspaceMemberModel.js');
vi.mock('../src/models/AuditLogModel.js');
vi.mock('../src/services/auditService.js');

describe('PrivacyService & Masking', () => {
  const privacyService = new PrivacyService();
  const mockUserId = new Types.ObjectId().toString();
  const mockWorkspaceId = new Types.ObjectId().toString();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('PII Masking Utilities', () => {
    it('should mask email addresses correctly', () => {
      expect(maskEmail('john.doe@example.com')).toBe('j***e@example.com');
      expect(maskEmail('a@b.com')).toBe('a***@b.com');
      expect(maskEmail('')).toBe('***@***.***');
    });

    it('should mask IP addresses correctly', () => {
      expect(maskIpAddress('192.168.1.100')).toBe('192.168.***.***');
      expect(maskIpAddress('10.0.0.1')).toBe('10.0.***.***');
      expect(maskIpAddress('2001:db8::1')).toBe('2001:db8:****:****');
      expect(maskIpAddress('')).toBe('***.***.***.***');
    });

    it('should recursively mask PII in objects and strings', () => {
      const input = {
        name: 'Alice',
        email: 'alice@domain.org',
        ipAddress: '172.16.254.1',
        password: 'SuperSecretPassword123!',
        token: 'Bearer eyJhbGciOi...',
        apiKey: 'sk-1234567890',
        nested: {
          contactEmail: 'support@domain.org',
          userIp: '10.20.30.40',
        },
      };

      const masked = maskPII(input) as any;

      expect(masked.name).toBe('Alice');
      expect(masked.email).toBe('a***e@domain.org');
      expect(masked.ipAddress).toBe('172.16.***.***');
      expect(masked.password).toBe('[REDACTED]');
      expect(masked.token).toBe('[REDACTED]');
      expect(masked.apiKey).toBe('[REDACTED]');
      expect(masked.nested.contactEmail).toBe('s***t@domain.org');
      expect(masked.nested.userIp).toBe('10.20.***.***');
    });
  });

  describe('Data Export Requests (GDPR Article 20)', () => {
    it('should generate a complete user data export package', async () => {
      (UserModel.findById as any).mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockUserId,
          email: 'user@example.com',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      });

      (WorkspaceMemberModel.find as any).mockReturnValue({
        populate: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            { workspaceId: { _id: mockWorkspaceId }, role: 'ADMIN', createdAt: new Date() },
          ]),
        }),
      });

      (WorkflowModel.find as any).mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          { _id: new Types.ObjectId(), name: 'Payment Flow', description: 'Processes invoices' },
        ]),
      });

      (WorkflowExecutionModel.find as any).mockReturnValue({
        limit: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([{ _id: new Types.ObjectId(), status: 'SUCCESS' }]),
        }),
      });

      (WorkflowCommentModel.find as any).mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      });

      (NotificationModel.find as any).mockReturnValue({
        limit: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([]),
        }),
      });

      (UserSessionModel.find as any).mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: new Types.ObjectId(), isActive: true }]),
      });

      const mockCreatedRequest = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(mockUserId),
        requestType: 'EXPORT',
        status: 'COMPLETED',
      };

      (PrivacyRequestModel.create as any).mockResolvedValue(mockCreatedRequest);
      (createAuditLog as any).mockResolvedValue(undefined);

      const result = await privacyService.requestDataExport(mockUserId, mockWorkspaceId);

      expect(result).toBeDefined();
      expect(PrivacyRequestModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestType: 'EXPORT',
          status: 'COMPLETED',
          metadata: expect.objectContaining({
            summary: expect.objectContaining({
              workspacesCount: 1,
              workflowsCount: 1,
              executionsCount: 1,
            }),
          }),
        })
      );
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PRIVACY_EXPORT_REQUESTED',
        })
      );
    });
  });

  describe('User Deletion / Right to be Forgotten (GDPR Article 17)', () => {
    it('should create a deletion request and execute cascading deletion if immediate', async () => {
      const mockCreatedRequest = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(mockUserId),
        requestType: 'DELETE',
        status: 'COMPLETED',
      };

      (PrivacyRequestModel.create as any).mockResolvedValue(mockCreatedRequest);
      (UserSessionModel.deleteMany as any).mockResolvedValue({ deletedCount: 2 });
      (RefreshTokenModel.deleteMany as any).mockResolvedValue({ deletedCount: 2 });
      (NotificationModel.deleteMany as any).mockResolvedValue({ deletedCount: 5 });
      (WorkspaceMemberModel.deleteMany as any).mockResolvedValue({ deletedCount: 1 });
      (WorkflowCommentModel.updateMany as any).mockResolvedValue({ modifiedCount: 3 });
      (AuditLogModel.updateMany as any).mockResolvedValue({ modifiedCount: 10 });
      (UserModel.findByIdAndDelete as any).mockResolvedValue({});
      (createAuditLog as any).mockResolvedValue(undefined);

      const result = await privacyService.requestUserDeletion(mockUserId, mockWorkspaceId, true);

      expect(result).toBeDefined();
      expect(UserSessionModel.deleteMany).toHaveBeenCalled();
      expect(RefreshTokenModel.deleteMany).toHaveBeenCalled();
      expect(NotificationModel.deleteMany).toHaveBeenCalled();
      expect(WorkspaceMemberModel.deleteMany).toHaveBeenCalled();
      expect(WorkflowCommentModel.updateMany).toHaveBeenCalled();
      expect(AuditLogModel.updateMany).toHaveBeenCalled();
      expect(UserModel.findByIdAndDelete).toHaveBeenCalled();
    });
  });

  describe('Privacy Preferences', () => {
    it('should get and update user privacy preferences', async () => {
      const initialPrefs = await privacyService.getPrivacyPreferences(mockUserId);
      expect(initialPrefs.analyticsConsent).toBe(true);
      expect(initialPrefs.marketingConsent).toBe(false);

      const updatedPrefs = await privacyService.updatePrivacyPreferences(mockUserId, {
        marketingConsent: true,
        retentionPeriodMonths: 6,
      });

      expect(updatedPrefs.marketingConsent).toBe(true);
      expect(updatedPrefs.retentionPeriodMonths).toBe(6);
    });
  });
});
