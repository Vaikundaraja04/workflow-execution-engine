import mongoose, { Schema, Document, Types } from 'mongoose';

export const AUDIT_ACTIONS = [
  'AUTH_REGISTERED',
  'AUTH_LOGIN_SUCCESS',
  'AUTH_LOGIN_FAILED',
  'AUTH_LOGOUT',
  'AUTH_REFRESH',
  'AUTH_REFRESH_REPLAY',
  'WORKFLOW_CREATED',
  'WORKFLOW_UPDATED',
  'WORKFLOW_DELETED',
  'EXECUTION_STARTED',
  'EXECUTION_REPLAYED',
  'WORKSPACE_CREATED',
  'WORKSPACE_UPDATED',
  'WORKSPACE_MEMBER_INVITED',
  'WORKSPACE_MEMBER_JOINED',
  'WORKSPACE_MEMBER_ROLE_CHANGED',
  'WORKSPACE_MEMBER_REMOVED',
  'WORKFLOW_TRANSFERRED',
  'API_KEY_CREATED',
  'API_KEY_REVOKED',
  'API_KEY_ROTATED',
  'API_KEY_RATE_LIMIT_UPDATED',
  'EXTERNAL_WORKFLOW_TRIGGERED',
  'WEBHOOK_CREATED',
  'WEBHOOK_UPDATED',
  'WEBHOOK_DELETED',
  'WEBHOOK_DELIVERY_FAILED',
  'WEBHOOK_DELIVERY_RETRIED',
  'DEVELOPER_DOCS_VIEWED',
  'SDK_REQUEST_EXECUTED',
  'QUEUE_PAUSED',
  'QUEUE_RESUMED',
  'EXECUTION_CANCELLED',
  'EXECUTION_RETRIED',
  'DATA_RETENTION_EXECUTED',
  'MAINTENANCE_MODE_UPDATED',
  'DISASTER_RECOVERY_SNAPSHOT_CREATED',
  'SUBSCRIPTION_CREATED',
  'SUBSCRIPTION_CHANGED',
  'SUBSCRIPTION_CANCELLED',
  'PAYMENT_FAILED',
  'PLAN_LIMIT_REACHED',
  'SSO_PROVIDER_CREATED',
  'SSO_PROVIDER_UPDATED',
  'SSO_PROVIDER_DISABLED',
  'SSO_LOGIN_SUCCESS',
  'SSO_LOGIN_FAILED',
  'SSO_IDENTITY_LINKED',
  'SSO_ENFORCEMENT_CHANGED',
  'SCIM_TOKEN_CREATED',
  'SCIM_TOKEN_REVOKED',
  'SCIM_USER_PROVISIONED',
  'SCIM_USER_UPDATED',
  'SCIM_USER_DEPROVISIONED',
  'TEMPLATE_CREATED',
  'TEMPLATE_UPDATED',
  'TEMPLATE_PUBLISHED',
  'TEMPLATE_ARCHIVED',
  'TEMPLATE_INSTALLED',
  'TEMPLATE_EXPORTED',
  'TEMPLATE_IMPORTED',
  'TEMPLATE_RATED',
  'AI_WORKFLOW_GENERATED',
  'AI_FAILURE_ANALYSIS_REQUESTED',
  'AI_OPTIMIZATION_CREATED',
  'AI_TEMPLATE_GENERATED',
  'AI_CONFIGURATION_UPDATED',
  'COMMENT_CREATED',
  'COMMENT_UPDATED',
  'COMMENT_DELETED',
  'COMMENT_RESOLVED',
  'WORKFLOW_LOCKED',
  'WORKFLOW_UNLOCKED',
  'NOTIFICATION_CREATED',
  'NOTIFICATION_READ',
  'SECURITY_THREAT_DETECTED',
  'SECURITY_EVENT_RESOLVED',
  'SECURITY_POLICY_UPDATED',
  'IP_ALLOWLIST_UPDATED',
  'SESSION_CREATED',
  'SESSION_REVOKED',
  'SESSION_REVOKED_ALL',
  'COMPLIANCE_REPORT_GENERATED',
  'AUDIT_LOGS_EXPORTED',
  'AUDIT_EXPORT_REQUESTED',
  'AUDIT_CHAIN_VERIFIED',
  'RETENTION_POLICY_UPDATED',
  'RETENTION_POLICY_DELETED',
  'RETENTION_POLICY_APPLIED',
  'PRIVACY_EXPORT_REQUESTED',
  'PRIVACY_EXPORT_DOWNLOADED',
  'PRIVACY_DELETE_REQUESTED',
  'PRIVACY_PREFERENCES_UPDATED',
  'SECRET_CREATED',
  'SECRET_ACCESSED',
  'SECRET_ROTATED',
  'SECRET_DELETED',
  'MFA_SETUP_INITIATED',
  'MFA_ENABLED',
  'MFA_DISABLED',
  'REPORT_GENERATED',
  'REPORT_DELETED',
  'REPORT_EXPORTED',
  'SECURITY_INTELLIGENCE_SCANNED',
  'OPERATIONS_METRICS_VIEWED',
  'AI_OPERATIONS_ASSISTANT_REQUESTED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface IAuditLog extends Document<Types.ObjectId> {
  userId?: Types.ObjectId;
  workspaceId?: Types.ObjectId;
  action: AuditAction;
  resource?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  prevHash?: string;
  recordHash?: string;
  signature?: string;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>({
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
  action: { type: String, enum: AUDIT_ACTIONS, required: true },
  resource: { type: String, maxlength: 64 },
  resourceId: { type: String, maxlength: 128 },
  metadata: { type: Schema.Types.Mixed },
  ipAddress: { type: String, maxlength: 64 },
  userAgent: { type: String, maxlength: 512 },
  prevHash: { type: String, maxlength: 64 },
  recordHash: { type: String, maxlength: 64 },
  signature: { type: String, maxlength: 128 },
}, { timestamps: { createdAt: true, updatedAt: false }, minimize: false });

AuditLogSchema.index({ userId: 1 });
AuditLogSchema.index({ action: 1 });
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ workspaceId: 1, createdAt: -1 });

export const AuditLogModel = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
