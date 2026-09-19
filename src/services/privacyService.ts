import { Types } from 'mongoose';
import { PrivacyRequestModel } from '../models/PrivacyRequestModel.js';
import type { IPrivacyRequest, PrivacyRequestType, PrivacyRequestStatus } from '../models/PrivacyRequestModel.js';
import { UserModel } from '../models/UserModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { WorkflowCommentModel } from '../models/WorkflowCommentModel.js';
import { NotificationModel } from '../models/NotificationModel.js';
import { UserSessionModel } from '../models/UserSessionModel.js';
import { RefreshTokenModel } from '../models/RefreshTokenModel.js';
import { WorkspaceMemberModel } from '../models/WorkspaceMemberModel.js';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { createAuditLog } from './auditService.js';

export interface PrivacyPreferences {
  analyticsConsent: boolean;
  marketingConsent: boolean;
  diagnosticsConsent: boolean;
  retentionPeriodMonths?: number;
  updatedAt?: Date;
}

// In-memory or metadata storage fallback for privacy preferences
const preferenceStore = new Map<string, PrivacyPreferences>();

export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '***@***.***';
  const parts = email.split('@');
  const local = parts[0] ?? '';
  const domain = parts[1] ?? '';
  if (local.length <= 2) {
    return `${local[0] || '*'}***@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

export function maskIpAddress(ip: string): string {
  if (!ip) return '***.***.***.***';
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.***.***`;
    }
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts[0]}:${parts[1] || '0'}:****:****`;
  }
  return '***.***.***.***';
}

export function maskPII(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    // Check for email
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    let masked = data.replace(emailRegex, (match) => maskEmail(match));
    // Check for IP
    const ipRegex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
    masked = masked.replace(ipRegex, (match) => maskIpAddress(match));
    return masked;
  }
  if (Array.isArray(data)) {
    return data.map((item) => maskPII(item));
  }
  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (/password|secret|token|authorization|apikey/i.test(key)) {
        result[key] = '[REDACTED]';
      } else if (/email/i.test(key) && typeof value === 'string') {
        result[key] = maskEmail(value);
      } else if (/ip|ipAddress/i.test(key) && typeof value === 'string') {
        result[key] = maskIpAddress(value);
      } else {
        result[key] = maskPII(value);
      }
    }
    return result;
  }
  return data;
}

export class PrivacyService {
  /**
   * Request a full GDPR user data export package
   */
  async requestDataExport(userId: string, workspaceId?: string): Promise<IPrivacyRequest> {
    const userObjectId = new Types.ObjectId(userId);
    const workspaceObjectId = workspaceId ? new Types.ObjectId(workspaceId) : undefined;

    // Gather user data
    const user = await UserModel.findById(userObjectId).lean();
    const workspaces = await WorkspaceMemberModel.find({ userId: userObjectId }).populate('workspaceId').lean();
    const workflows = await WorkflowModel.find({ createdBy: userObjectId }).lean();
    const executions = await WorkflowExecutionModel.find({ initiatedBy: userObjectId }).limit(100).lean();
    const comments = await WorkflowCommentModel.find({ authorId: userObjectId }).lean();
    const notifications = await NotificationModel.find({ userId: userObjectId }).limit(100).lean();
    const sessions = await UserSessionModel.find({ userId: userObjectId }).lean();

    const exportBundle = {
      exportVersion: '1.0',
      exportedAt: new Date().toISOString(),
      user: user ? {
        id: user._id,
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      } : null,
      workspaces: workspaces.map((w: any) => ({
        workspaceId: w.workspaceId?._id || w.workspaceId,
        role: w.role,
        joinedAt: w.createdAt,
      })),
      workflows: workflows.map((wf) => ({
        id: wf._id,
        name: wf.name,
        createdAt: wf.createdAt,
      })),
      executionsCount: executions.length,
      commentsCount: comments.length,
      notificationsCount: notifications.length,
      activeSessionsCount: sessions.filter((s) => !s.isRevoked && new Date(s.expiresAt) > new Date()).length,
      privacyPreferences: await this.getPrivacyPreferences(userId),
    };

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Export download link expires in 7 days

    const createPayload: any = {
      userId: userObjectId,
      requestType: 'EXPORT',
      status: 'COMPLETED',
      requestedAt: new Date(),
      processedAt: new Date(),
      completedAt: new Date(),
      expiresAt,
      metadata: {
        summary: {
          workspacesCount: workspaces.length,
          workflowsCount: workflows.length,
          executionsCount: executions.length,
          commentsCount: comments.length,
        },
        data: exportBundle,
      },
    };
    if (workspaceObjectId) {
      createPayload.workspaceId = workspaceObjectId;
    }

    const privacyRequest = (await PrivacyRequestModel.create(createPayload)) as any;

    await createAuditLog({
      action: 'PRIVACY_EXPORT_REQUESTED',
      userId: userObjectId,
      workspaceId: workspaceObjectId,
      resource: 'PrivacyRequest',
      resourceId: privacyRequest._id.toString(),
      metadata: {
        requestId: privacyRequest._id.toString(),
        requestType: 'EXPORT',
      },
    });

    return privacyRequest;
  }

  /**
   * Request user deletion / Right to be Forgotten
   */
  async requestUserDeletion(
    userId: string,
    workspaceId?: string,
    immediate: boolean = false
  ): Promise<IPrivacyRequest> {
    const userObjectId = new Types.ObjectId(userId);
    const workspaceObjectId = workspaceId ? new Types.ObjectId(workspaceId) : undefined;

    const createPayload: any = {
      userId: userObjectId,
      requestType: 'DELETE',
      status: immediate ? 'COMPLETED' : 'PENDING',
      requestedAt: new Date(),
      metadata: {
        immediate,
        requestedDeletionDate: new Date().toISOString(),
      },
    };
    if (workspaceObjectId) {
      createPayload.workspaceId = workspaceObjectId;
    }
    if (immediate) {
      createPayload.processedAt = new Date();
      createPayload.completedAt = new Date();
    }

    const privacyRequest = (await PrivacyRequestModel.create(createPayload)) as any;

    if (immediate) {
      await this.executeUserDeletion(userId);
    }

    await createAuditLog({
      action: 'PRIVACY_DELETE_REQUESTED',
      userId: userObjectId,
      workspaceId: workspaceObjectId,
      resource: 'PrivacyRequest',
      resourceId: privacyRequest._id.toString(),
      metadata: {
        requestId: privacyRequest._id.toString(),
        immediate,
      },
    });

    return privacyRequest;
  }

  /**
   * Execute cascading user data deletion and audit anonymization
   */
  async executeUserDeletion(userId: string): Promise<void> {
    const userObjectId = new Types.ObjectId(userId);

    // 1. Terminate all active sessions & refresh tokens
    await UserSessionModel.deleteMany({ userId: userObjectId });
    await RefreshTokenModel.deleteMany({ userId: userObjectId });

    // 2. Remove notifications
    await NotificationModel.deleteMany({ userId: userObjectId });

    // 3. Remove workspace memberships
    await WorkspaceMemberModel.deleteMany({ userId: userObjectId });

    // 4. Anonymize comments
    await WorkflowCommentModel.updateMany(
      { authorId: userObjectId },
      { content: '[Content removed due to user deletion]' }
    );

    // 5. Anonymize user records in audit logs
    const anonymousId = new Types.ObjectId();
    await AuditLogModel.updateMany(
      { userId: userObjectId },
      {
        $set: {
          userId: anonymousId,
          userAgent: 'ANONYMIZED',
          ipAddress: '0.0.0.0',
        },
      }
    );

    // 6. Delete user account
    await UserModel.findByIdAndDelete(userObjectId);
  }

  /**
   * List privacy requests for a user
   */
  async getUserPrivacyRequests(userId: string): Promise<IPrivacyRequest[]> {
    return PrivacyRequestModel.find({ userId: new Types.ObjectId(userId) })
      .sort({ requestedAt: -1 })
      .lean();
  }

  /**
   * Get user privacy preferences
   */
  async getPrivacyPreferences(userId: string): Promise<PrivacyPreferences> {
    const existing = preferenceStore.get(userId);
    if (existing) return existing;

    const defaultPrefs: PrivacyPreferences = {
      analyticsConsent: true,
      marketingConsent: false,
      diagnosticsConsent: true,
      retentionPeriodMonths: 12,
      updatedAt: new Date(),
    };
    preferenceStore.set(userId, defaultPrefs);
    return defaultPrefs;
  }

  /**
   * Update user privacy preferences
   */
  async updatePrivacyPreferences(
    userId: string,
    preferences: Partial<PrivacyPreferences>
  ): Promise<PrivacyPreferences> {
    const current = await this.getPrivacyPreferences(userId);
    const updated: PrivacyPreferences = {
      ...current,
      ...preferences,
      updatedAt: new Date(),
    };
    preferenceStore.set(userId, updated);
    return updated;
  }
}

export const privacyService = new PrivacyService();
