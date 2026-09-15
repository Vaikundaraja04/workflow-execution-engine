import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import type { WorkspaceRole } from '../models/WorkspaceMemberModel.js';
import { WorkspaceMemberModel } from '../models/WorkspaceMemberModel.js';
import { UserModel } from '../models/UserModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { createAuditLog } from './auditService.js';
import { permissionsForRole } from '../auth/permissions.js';

export interface WorkspaceView {
  id: string;
  name: string;
  slug: string;
  description?: string | undefined;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  ownerId: string;
  role: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 11000;
}

function assertValidId(id: string, errorCode: string): void {
  if (!Types.ObjectId.isValid(id)) throw new Error(errorCode);
}
function toWorkspaceView(workspace: {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string | undefined;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  ownerId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}, role: WorkspaceRole): WorkspaceView {
  return {
    id: workspace._id.toString(),
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    status: workspace.status,
    ownerId: workspace.ownerId.toString(),
    role,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  };
}

async function findActiveMembership(workspaceId: string, userId: string) {
  return WorkspaceMemberModel.findOne({
    workspaceId,
    userId: new Types.ObjectId(userId),
    status: 'ACTIVE',
  });
}
export async function ensureUserWorkspace(userId: string): Promise<string> {
  const user = await UserModel.findById(userId);
  if (!user) throw new Error('USER_NOT_FOUND');

  if (user.defaultWorkspaceId) {
    const current = await WorkspaceModel.findById(user.defaultWorkspaceId);
    if (current) return current._id.toString();
  }

  const slug = `personal-${userId}`;
  let workspace = await WorkspaceModel.findOne({ slug });
  if (!workspace) {
    try {
      workspace = await WorkspaceModel.create({
        name: 'Personal',
        slug,
        ownerId: new Types.ObjectId(userId),
        status: 'ACTIVE',
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      workspace = await WorkspaceModel.findOne({ slug });
      if (!workspace) throw error;
    }
  }

  const memberExists = await WorkspaceMemberModel.exists({
    workspaceId: workspace._id,
    userId: new Types.ObjectId(userId),
  });
  if (!memberExists) {
    try {
      await WorkspaceMemberModel.create({
        workspaceId: workspace._id,
        userId: new Types.ObjectId(userId),
        role: 'OWNER',
        permissions: permissionsForRole('OWNER'),
        status: 'ACTIVE',
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  if (!user.defaultWorkspaceId) {
    await UserModel.updateOne({ _id: user._id }, { $set: { defaultWorkspaceId: workspace._id } });
  }
  return workspace._id.toString();
}
export async function resolveWorkspaceId(userId: string, requested?: string): Promise<string> {
  if (requested !== undefined) {
    const membership = await findActiveMembership(requested, userId);
    if (!membership) throw new Error('WORKSPACE_NOT_FOUND');
    return membership.workspaceId.toString();
  }
  return ensureUserWorkspace(userId);
}

export async function createWorkspace(
  userId: string,
  input: { name: string; slug?: string | undefined; description?: string | undefined },
): Promise<WorkspaceView> {
  const name = input.name.trim();
  const slug = (input.slug ?? `ws-${randomUUID().slice(0, 8)}`).trim().toLowerCase();
  const workspace = await WorkspaceModel.create({
    name,
    slug,
    ...(input.description !== undefined ? { description: input.description.trim() } : {}),
    ownerId: new Types.ObjectId(userId),
    status: 'ACTIVE',
  });
  await WorkspaceMemberModel.create({
    workspaceId: workspace._id,
    userId: new Types.ObjectId(userId),
    role: 'OWNER',
    permissions: permissionsForRole('OWNER'),
    status: 'ACTIVE',
  });
  await createAuditLog({
    action: 'WORKSPACE_CREATED',
    userId,
    resource: 'workspace',
    resourceId: workspace._id.toString(),
  });
  return toWorkspaceView(workspace.toObject(), 'OWNER');
}
export async function getWorkspace(workspaceId: string, userId: string): Promise<WorkspaceView> {
  assertValidId(workspaceId, 'INVALID_WORKSPACE_ID');
  const membership = await findActiveMembership(workspaceId, userId);
  if (!membership) throw new Error('WORKSPACE_NOT_FOUND');
  const workspace = await WorkspaceModel.findById(workspaceId);
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
  return toWorkspaceView(workspace, membership.role);
}

export async function listUserWorkspaces(userId: string): Promise<WorkspaceView[]> {
  const members = await WorkspaceMemberModel.find({
    userId: new Types.ObjectId(userId),
    status: 'ACTIVE',
  }).lean();
  if (members.length === 0) return [];
  const ids = members.map(member => member.workspaceId);
  const workspaces = await WorkspaceModel.find({ _id: { $in: ids } }).sort({ createdAt: -1 }).lean();
  const roleByWorkspace = new Map<string, WorkspaceRole>();
  for (const member of members) roleByWorkspace.set(member.workspaceId.toString(), member.role);
  return workspaces.map(workspace =>
    toWorkspaceView(workspace, roleByWorkspace.get(workspace._id.toString()) ?? 'VIEWER'));
}
export async function updateWorkspace(
  workspaceId: string,
  userId: string,
  updates: { name?: string | undefined; description?: string | undefined },
): Promise<WorkspaceView> {
  assertValidId(workspaceId, 'INVALID_WORKSPACE_ID');
  const membership = await findActiveMembership(workspaceId, userId);
  if (!membership) throw new Error('WORKSPACE_NOT_FOUND');
  if (membership.role !== 'OWNER') throw new Error('FORBIDDEN');
  const workspace = await WorkspaceModel.findById(workspaceId);
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
  if (updates.name !== undefined) workspace.name = updates.name.trim();
  if (updates.description !== undefined) workspace.description = updates.description.trim();
  await workspace.save();
  await createAuditLog({
    action: 'WORKSPACE_UPDATED',
    userId,
    resource: 'workspace',
    resourceId: workspaceId,
  });
  return toWorkspaceView(workspace, 'OWNER');
}
export interface MigrationSummary {
  users: number;
  workflowsBackfilled: number;
  executionsBackfilled: number;
  auditBackfilled: number;
}

export async function backfillLegacyWorkspaceData(): Promise<MigrationSummary> {
  const users = await UserModel.find({});
  let workflowsBackfilled = 0;
  let executionsBackfilled = 0;
  let auditBackfilled = 0;
  for (const user of users) {
    const workspaceId = await ensureUserWorkspace(user._id.toString());
    const objectId = user._id;
    const [workflows, executions, audit] = await Promise.all([
      WorkflowModel.updateMany(
        { ownerId: objectId, workspaceId: { $exists: false } },
        { $set: { workspaceId, createdBy: objectId } },
      ),
      WorkflowExecutionModel.updateMany(
        { ownerId: objectId, workspaceId: { $exists: false } },
        { $set: { workspaceId } },
      ),
      AuditLogModel.updateMany(
        { userId: objectId, workspaceId: { $exists: false } },
        { $set: { workspaceId } },
      ),
    ]);
    workflowsBackfilled += workflows.modifiedCount;
    executionsBackfilled += executions.modifiedCount;
    auditBackfilled += audit.modifiedCount;
  }
  return {
    users: users.length,
    workflowsBackfilled,
    executionsBackfilled,
    auditBackfilled,
  };
}
