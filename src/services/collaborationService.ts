import mongoose, { Types } from 'mongoose';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../models/WorkspaceMemberModel.js';
import { permissionsForRole } from '../auth/permissions.js';
import type { WorkspaceRole } from '../models/WorkspaceMemberModel.js';
import { createAuditLog } from './auditService.js';
import { findTargetMembership, getActiveMembership, requireWorkspace } from './memberService.js';
import { tenantScope } from './tenantScope.js';

const TRANSFER_MAX_ATTEMPTS = 3;
const TRANSFER_RETRY_BASE_DELAY_MS = 50;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTransactionError(error: unknown): boolean {
  const labels = (error as { errorLabels?: string[] } | null)?.errorLabels ?? [];
  if (labels.includes('TransientTransactionError')) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /catalog changes/i.test(message) || /Unable to acquire .* lock/i.test(message);
}

export interface TransferSummary {
  workflowId: string;
  workspaceId: string;
  previousOwnerId: string;
  previousOwnerRole: WorkspaceRole;
  newOwnerId: string;
  newOwnerRole: WorkspaceRole;
}

export async function transferWorkflowOwnership(
  workflowId: string,
  actorId: string,
  targetReference: string,
  workspaceId: string,
): Promise<TransferSummary> {
  if (!Types.ObjectId.isValid(workflowId)) throw new Error('INVALID_WORKFLOW_ID');

  const workflow = await WorkflowModel.findOne({ _id: workflowId, ...tenantScope(actorId, workspaceId) });
  if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');

  const actor = await getActiveMembership(workspaceId, actorId);
  if (actor.role !== 'OWNER') throw new Error('FORBIDDEN');

  const target = await findTargetMembership(workspaceId, targetReference);
  if (!target) throw new Error('MEMBER_NOT_FOUND');
  if (target.status !== 'ACTIVE') throw new Error('INVALID_TRANSFER_TARGET');
  if (target.role === 'OWNER') throw new Error('OWNER_ROLE_IMMUTABLE');

  await requireWorkspace(workspaceId);

  const session = await mongoose.startSession();
  try {
    for (let attempt = 1; ; attempt += 1) {
      session.startTransaction();
      try {
        const downgradeOwner = await WorkspaceMemberModel.updateOne(
          { _id: actor._id, role: 'OWNER' },
          { $set: { role: 'EDITOR', permissions: permissionsForRole('EDITOR') } },
          { session },
        );
        if (downgradeOwner.matchedCount === 0) throw new Error('OWNER_ROLE_IMMUTABLE');

        const promoteTarget = await WorkspaceMemberModel.updateOne(
          { _id: target._id, status: 'ACTIVE' },
          { $set: { role: 'OWNER', permissions: permissionsForRole('OWNER') } },
          { session },
        );
        if (promoteTarget.matchedCount === 0) throw new Error('MEMBER_NOT_FOUND');

        const moveWorkspace = await WorkspaceModel.updateOne(
          { _id: workspaceId },
          { $set: { ownerId: target.userId } },
          { session },
        );
        if (moveWorkspace.matchedCount === 0) throw new Error('WORKSPACE_NOT_FOUND');

        const moveWorkflow = await WorkflowModel.updateOne(
          { _id: workflowId },
          { $set: { ownerId: target.userId } },
          { session },
        );
        if (moveWorkflow.matchedCount === 0) throw new Error('WORKFLOW_NOT_FOUND');

        await session.commitTransaction();
        break;
      } catch (error) {
        await session.abortTransaction();
        if (attempt >= TRANSFER_MAX_ATTEMPTS || !isRetryableTransactionError(error)) throw error;
        await delay(TRANSFER_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  } finally {
    session.endSession();
  }

  await createAuditLog({
    action: 'WORKFLOW_TRANSFERRED',
    userId: actorId,
    workspaceId,
    resource: 'workflow',
    resourceId: workflowId,
    metadata: {
      previousOwnerId: actor.userId.toString(),
      newOwnerId: target.userId.toString(),
    },
  });

  return {
    workflowId,
    workspaceId,
    previousOwnerId: actor.userId.toString(),
    previousOwnerRole: 'EDITOR',
    newOwnerId: target.userId.toString(),
    newOwnerRole: 'OWNER',
  };
}
