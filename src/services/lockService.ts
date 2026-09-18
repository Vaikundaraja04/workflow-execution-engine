import { Types } from 'mongoose';
import crypto from 'node:crypto';
import { WorkflowLockModel } from '../models/WorkflowLockModel.js';
import type { IWorkflowLock } from '../models/WorkflowLockModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { checkUserPermission } from './permissionService.js';
import { createAuditLog } from './auditService.js';
import { emitToWorkflow, emitToUser } from '../realtime/socketServer.js';
import { COLLABORATION_EVENTS } from '../realtime/collaborationEvents.js';

export interface LockInfo {
  workflowId: string;
  workspaceId: string;
  userId: string;
  userName: string;
  userEmail: string;
  lockToken: string;
  acquiredAt: Date;
  expiresAt: Date;
  isOwner: boolean;
  ttlRemainingMs: number;
}

export interface AcquireLockResult {
  acquired: boolean;
  lock?: LockInfo;
  conflict?: {
    userId: string;
    userName: string;
    userEmail: string;
    expiresAt: Date;
    acquiredAt: Date;
  };
}

export class LockService {
  private defaultTtlMs = 60_000; // 60 seconds

  /**
   * Acquire an exclusive editing lock on a workflow
   */
  async acquireLock(
    workflowId: string,
    workspaceId: string,
    userId: string,
    userEmail: string,
    userName?: string,
    ttlSeconds: number = 60,
  ): Promise<AcquireLockResult> {
    if (!Types.ObjectId.isValid(workflowId) || !Types.ObjectId.isValid(workspaceId) || !Types.ObjectId.isValid(userId)) {
      throw new Error('INVALID_ID');
    }

    const permissionCheck = await checkUserPermission(workspaceId, userId, 'WORKFLOW_UPDATE');
    if (permissionCheck.outcome !== 'allow') {
      throw new Error('PERMISSION_DENIED');
    }

    const now = new Date();
    const ttlMs = Math.max(1, Math.min(300, ttlSeconds)) * 1000;
    const expiresAt = new Date(now.getTime() + ttlMs);
    const lockToken = crypto.randomBytes(16).toString('hex');
    const name: string = userName || (userEmail.split('@')[0] ?? 'User');

    // Find existing lock for this workflow
    const existingLock = await WorkflowLockModel.findOne({
      workflowId: new Types.ObjectId(workflowId),
    });

    if (existingLock) {
      const isExpired = existingLock.expiresAt.getTime() <= now.getTime();
      const isSameUser = existingLock.userId.toString() === userId;

      if (isSameUser) {
        // Refresh existing lock held by same user
        existingLock.expiresAt = expiresAt;
        existingLock.lastHeartbeat = now;
        await existingLock.save();

        const lockInfo: LockInfo = {
          workflowId,
          workspaceId: existingLock.workspaceId.toString(),
          userId: existingLock.userId.toString(),
          userName: existingLock.userName,
          userEmail: existingLock.userEmail,
          lockToken: existingLock.lockToken,
          acquiredAt: existingLock.acquiredAt,
          expiresAt: existingLock.expiresAt,
          isOwner: true,
          ttlRemainingMs: existingLock.expiresAt.getTime() - now.getTime(),
        };

        emitToWorkflow(workflowId, COLLABORATION_EVENTS.LOCK_HEARTBEAT, { lock: lockInfo });
        return { acquired: true, lock: lockInfo };
      }

      if (!isExpired) {
        // Active lock held by someone else -> Conflict
        return {
          acquired: false,
          conflict: {
            userId: existingLock.userId.toString(),
            userName: existingLock.userName,
            userEmail: existingLock.userEmail,
            expiresAt: existingLock.expiresAt,
            acquiredAt: existingLock.acquiredAt,
          },
        };
      }

      // Expired lock -> Remove and replace
      await WorkflowLockModel.deleteOne({ _id: existingLock._id });
    }

    // Create new lock
    const newLock = await WorkflowLockModel.create({
      workflowId: new Types.ObjectId(workflowId),
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(userId),
      userEmail,
      userName: name,
      lockToken,
      acquiredAt: now,
      expiresAt,
      lastHeartbeat: now,
    });

    const lockInfo: LockInfo = {
      workflowId,
      workspaceId,
      userId,
      userName: name,
      userEmail,
      lockToken,
      acquiredAt: now,
      expiresAt,
      isOwner: true,
      ttlRemainingMs: ttlMs,
    };

    await createAuditLog({
      action: 'WORKFLOW_LOCKED',
      userId,
      workspaceId,
      resource: 'Workflow',
      resourceId: workflowId,
      metadata: { ttlSeconds },
    });

    // Notify others in workflow room
    emitToWorkflow(workflowId, COLLABORATION_EVENTS.LOCK_ACQUIRED, {
      workflowId,
      userId,
      userName: name,
      userEmail,
      expiresAt,
    });

    return { acquired: true, lock: lockInfo };
  }

  /**
   * Heartbeat to keep lock alive
   */
  async heartbeat(
    workflowId: string,
    workspaceId: string,
    userId: string,
    lockToken: string,
    ttlSeconds: number = 60,
  ): Promise<LockInfo | null> {
    if (!Types.ObjectId.isValid(workflowId) || !Types.ObjectId.isValid(userId)) {
      return null;
    }

    const now = new Date();
    const ttlMs = Math.max(1, Math.min(300, ttlSeconds)) * 1000;
    const expiresAt = new Date(now.getTime() + ttlMs);

    const lock = await WorkflowLockModel.findOneAndUpdate(
      {
        workflowId: new Types.ObjectId(workflowId),
        userId: new Types.ObjectId(userId),
        lockToken,
      },
      {
        $set: {
          expiresAt,
          lastHeartbeat: now,
        },
      },
      { new: true },
    );

    if (!lock) return null;

    const lockInfo: LockInfo = {
      workflowId,
      workspaceId: lock.workspaceId.toString(),
      userId: lock.userId.toString(),
      userName: lock.userName,
      userEmail: lock.userEmail,
      lockToken: lock.lockToken,
      acquiredAt: lock.acquiredAt,
      expiresAt: lock.expiresAt,
      isOwner: true,
      ttlRemainingMs: lock.expiresAt.getTime() - now.getTime(),
    };

    emitToWorkflow(workflowId, COLLABORATION_EVENTS.LOCK_HEARTBEAT, {
      workflowId,
      userId,
      expiresAt,
    });

    return lockInfo;
  }

  /**
   * Release lock
   */
  async releaseLock(
    workflowId: string,
    workspaceId: string,
    userId: string,
    lockToken?: string,
    force: boolean = false,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(workflowId) || !Types.ObjectId.isValid(workspaceId) || !Types.ObjectId.isValid(userId)) {
      return false;
    }

    const lock = await WorkflowLockModel.findOne({
      workflowId: new Types.ObjectId(workflowId),
    });

    if (!lock) return true;

    if (force) {
      const permissionCheck = await checkUserPermission(workspaceId, userId, 'COLLABORATION_MANAGE');
      if (permissionCheck.outcome !== 'allow') {
        throw new Error('PERMISSION_DENIED');
      }
    } else {
      if (lock.userId.toString() !== userId) {
        throw new Error('CANNOT_RELEASE_OTHERS_LOCK');
      }
      if (lockToken && lock.lockToken !== lockToken) {
        throw new Error('INVALID_LOCK_TOKEN');
      }
    }

    await WorkflowLockModel.deleteOne({ _id: lock._id });

    await createAuditLog({
      action: 'WORKFLOW_UNLOCKED',
      userId,
      workspaceId,
      resource: 'Workflow',
      resourceId: workflowId,
      metadata: { forced: force },
    });

    emitToWorkflow(workflowId, COLLABORATION_EVENTS.LOCK_RELEASED, {
      workflowId,
      releasedBy: userId,
      forced: force,
    });

    return true;
  }

  /**
   * Get current lock info for a workflow
   */
  async getLock(workflowId: string, userId?: string): Promise<LockInfo | null> {
    if (!Types.ObjectId.isValid(workflowId)) return null;

    const lock = await WorkflowLockModel.findOne({
      workflowId: new Types.ObjectId(workflowId),
    });

    if (!lock) return null;

    const now = new Date();
    if (lock.expiresAt.getTime() <= now.getTime()) {
      await WorkflowLockModel.deleteOne({ _id: lock._id });
      return null;
    }

    return {
      workflowId,
      workspaceId: lock.workspaceId.toString(),
      userId: lock.userId.toString(),
      userName: lock.userName,
      userEmail: lock.userEmail,
      lockToken: userId === lock.userId.toString() ? lock.lockToken : '',
      acquiredAt: lock.acquiredAt,
      expiresAt: lock.expiresAt,
      isOwner: userId === lock.userId.toString(),
      ttlRemainingMs: Math.max(0, lock.expiresAt.getTime() - now.getTime()),
    };
  }
}

export const lockService = new LockService();
