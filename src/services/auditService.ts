import { Types } from 'mongoose';
import { AuditLogModel } from '../models/AuditLogModel.js';
import type { AuditAction } from '../models/AuditLogModel.js';

export interface CreateAuditLogInput {
  action: AuditAction;
  userId?: Types.ObjectId | string | undefined;
  resource?: string | undefined;
  resourceId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

const SENSITIVE_KEY_PATTERN = /password|token|secret/i;

export function sanitizeAuditMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

export async function createAuditLog(input: CreateAuditLogInput): Promise<void> {
  try {
    const doc: {
      action: AuditAction;
      userId?: Types.ObjectId;
      resource?: string;
      resourceId?: string;
      metadata?: Record<string, unknown>;
      ipAddress?: string;
      userAgent?: string;
    } = { action: input.action };

    if (input.userId !== undefined) {
      doc.userId = typeof input.userId === 'string' ? new Types.ObjectId(input.userId) : input.userId;
    }
    if (input.resource !== undefined) doc.resource = input.resource;
    if (input.resourceId !== undefined) doc.resourceId = input.resourceId;
    if (input.metadata !== undefined) doc.metadata = sanitizeAuditMetadata(input.metadata);
    if (input.ipAddress !== undefined) doc.ipAddress = input.ipAddress;
    if (input.userAgent !== undefined) doc.userAgent = input.userAgent;

    await AuditLogModel.create(doc);
  } catch (error) {
    console.error('Failed to write audit log', error);
  }
}