import mongoose, { Types } from 'mongoose';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { permissionsForRole } from '../auth/permissions.js';
import type { WorkspaceRole } from '../models/WorkspaceMemberModel.js';
import { createAuditLog } from './auditService.js';
import { findTargetMembership, getActiveMembership, requireWorkspace } from './memberService.js';
import { tenantScope } from './tenantScope.js';

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

  const workspace = await requireWorkspace(workspaceId);

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    actor.role = 'EDITOR';
    actor.permissions = permissionsForRole('EDITOR');
    await actor.save({ session });

    target.role = 'OWNER';
    target.permissions = permissionsForRole('OWNER');
    await target.save({ session });

    workspace.ownerId = target.userId;
    await workspace.save({ session });

    workflow.ownerId = target.userId;
    await workflow.save({ session });

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
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
