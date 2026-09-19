import { Types } from 'mongoose';
import { createHash, createHmac } from 'node:crypto';
import { AuditLogModel } from '../models/AuditLogModel.js';
import type { AuditAction, IAuditLog } from '../models/AuditLogModel.js';

export interface CreateAuditLogInput {
  action: AuditAction;
  userId?: Types.ObjectId | string | undefined;
  workspaceId?: Types.ObjectId | string | undefined;
  resource?: string | undefined;
  resourceId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

const SENSITIVE_KEY_PATTERN = /password|token|secret|authorization/i;
const GENESIS_HASH = 'GENESIS_00000000000000000000000000000000000000000000000000000000';

function getAuditHmacSecret(): string {
  return process.env.AUDIT_HMAC_SECRET || process.env.JWT_SECRET || 'audit-immutable-chain-hmac-secret-default-key-32chars';
}

export function sanitizeAuditMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

export function computeRecordHash(payload: {
  prevHash: string;
  action: string;
  userId?: string | null;
  workspaceId?: string | null;
  resource?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): string {
  const normalized = JSON.stringify({
    prevHash: payload.prevHash,
    action: payload.action,
    userId: payload.userId || null,
    workspaceId: payload.workspaceId || null,
    resource: payload.resource || null,
    resourceId: payload.resourceId || null,
    metadata: payload.metadata || null,
    ipAddress: payload.ipAddress || null,
    userAgent: payload.userAgent || null,
  });
  return createHash('sha256').update(normalized).digest('hex');
}

export function computeAuditSignature(recordHash: string): string {
  const secret = getAuditHmacSecret();
  return createHmac('sha256', secret).update(recordHash).digest('hex');
}

export async function createAuditLog(input: CreateAuditLogInput): Promise<IAuditLog | null> {
  try {
    const doc: {
      action: AuditAction;
      userId?: Types.ObjectId;
      workspaceId?: Types.ObjectId;
      resource?: string;
      resourceId?: string;
      metadata?: Record<string, unknown>;
      ipAddress?: string;
      userAgent?: string;
      prevHash?: string;
      recordHash?: string;
      signature?: string;
    } = { action: input.action };

    if (input.workspaceId !== undefined) {
      doc.workspaceId = typeof input.workspaceId === 'string' ? new Types.ObjectId(input.workspaceId) : input.workspaceId;
    }
    if (input.userId !== undefined) {
      doc.userId = typeof input.userId === 'string' ? new Types.ObjectId(input.userId) : input.userId;
    }
    if (input.resource !== undefined) doc.resource = input.resource;
    if (input.resourceId !== undefined) doc.resourceId = input.resourceId;
    if (input.metadata !== undefined) doc.metadata = sanitizeAuditMetadata(input.metadata);
    if (input.ipAddress !== undefined) doc.ipAddress = input.ipAddress;
    if (input.userAgent !== undefined) doc.userAgent = input.userAgent;

    // Cryptographic hash chaining: Find the most recent audit log for this workspace / global
    const filter = doc.workspaceId ? { workspaceId: doc.workspaceId } : { workspaceId: { $exists: false } };
    const lastLog = await AuditLogModel.findOne(filter).sort({ createdAt: -1, _id: -1 }).select('recordHash');

    const prevHash = lastLog?.recordHash || GENESIS_HASH;
    const recordHash = computeRecordHash({
      prevHash,
      action: doc.action,
      userId: doc.userId?.toString() || null,
      workspaceId: doc.workspaceId?.toString() || null,
      resource: doc.resource || null,
      resourceId: doc.resourceId || null,
      metadata: doc.metadata || null,
      ipAddress: doc.ipAddress || null,
      userAgent: doc.userAgent || null,
    });
    const signature = computeAuditSignature(recordHash);

    doc.prevHash = prevHash;
    doc.recordHash = recordHash;
    doc.signature = signature;

    return await AuditLogModel.create(doc);
  } catch (error) {
    console.error('Failed to write audit log', error);
    return null;
  }
}

export interface VerifyChainResult {
  valid: boolean;
  totalChecked: number;
  brokenAtLogId?: string;
  reason?: string;
}

export async function verifyAuditChain(workspaceId?: string | Types.ObjectId): Promise<VerifyChainResult> {
  const query = workspaceId ? { workspaceId: new Types.ObjectId(workspaceId.toString()) } : {};
  const logs = await AuditLogModel.find(query).sort({ createdAt: 1, _id: 1 });

  let expectedPrevHash = GENESIS_HASH;

  for (const log of logs) {
    // If it's a legacy record without hash chaining, skip or treat as genesis
    if (!log.recordHash || !log.signature) {
      continue;
    }

    // Verify HMAC signature
    const computedSig = computeAuditSignature(log.recordHash);
    if (computedSig !== log.signature) {
      return {
        valid: false,
        totalChecked: logs.length,
        brokenAtLogId: log._id.toString(),
        reason: 'HMAC signature verification failed (record altered)',
      };
    }

    // Verify record hash contents
    const computedHash = computeRecordHash({
      prevHash: log.prevHash || GENESIS_HASH,
      action: log.action,
      userId: log.userId?.toString() || null,
      workspaceId: log.workspaceId?.toString() || null,
      resource: log.resource || null,
      resourceId: log.resourceId || null,
      metadata: log.metadata || null,
      ipAddress: log.ipAddress || null,
      userAgent: log.userAgent || null,
    });

    if (computedHash !== log.recordHash) {
      return {
        valid: false,
        totalChecked: logs.length,
        brokenAtLogId: log._id.toString(),
        reason: 'Computed record hash mismatch',
      };
    }

    // Verify chain linkage
    if (log.prevHash && log.prevHash !== expectedPrevHash && expectedPrevHash !== GENESIS_HASH) {
      return {
        valid: false,
        totalChecked: logs.length,
        brokenAtLogId: log._id.toString(),
        reason: `Broken chain link: prevHash ${log.prevHash} does not match expected ${expectedPrevHash}`,
      };
    }

    expectedPrevHash = log.recordHash;
  }

  return {
    valid: true,
    totalChecked: logs.length,
  };
}