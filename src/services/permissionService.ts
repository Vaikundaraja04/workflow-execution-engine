import { Types } from 'mongoose';
import { WorkspaceMemberModel } from '../models/WorkspaceMemberModel.js';
import type { MembershipStatus, WorkspaceRole } from '../models/WorkspaceMemberModel.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { permissionsForRole, roleHasPermission } from '../auth/permissions.js';
import type { Permission } from '../auth/permissions.js';

export interface MembershipSnapshot {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  status: MembershipStatus;
  permissions: Permission[];
}

export interface WorkspaceContext {
  workspaceId: string;
  role: WorkspaceRole;
  permissions: Permission[];
}

export type PermissionOutcome = 'allow' | 'forbidden' | 'denied' | 'absent';

export interface PermissionCheck {
  outcome: PermissionOutcome;
  membership: MembershipSnapshot | null;
}

export function resolveRolePermissions(role: WorkspaceRole): Permission[] {
  return permissionsForRole(role);
}

export async function findMembership(workspaceId: string, userId: string): Promise<MembershipSnapshot | null> {
  if (!Types.ObjectId.isValid(workspaceId) || !Types.ObjectId.isValid(userId)) return null;
  const member = await WorkspaceMemberModel.findOne({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: new Types.ObjectId(userId),
  }).lean();
  if (!member) return null;
  return {
    workspaceId: member.workspaceId.toString(),
    userId: member.userId.toString(),
    role: member.role,
    status: member.status,
    permissions: permissionsForRole(member.role),
  };
}

export async function isWorkspaceActive(workspaceId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(workspaceId)) return false;
  const workspace = await WorkspaceModel.findById(workspaceId).select('status').lean();
  return workspace?.status === 'ACTIVE';
}

async function evaluateMembership(
  workspaceId: string,
  userId: string,
  permission?: Permission,
): Promise<PermissionCheck> {
  const membership = await findMembership(workspaceId, userId);
  if (!membership || membership.status === 'REMOVED') return { outcome: 'absent', membership: null };
  if (membership.status !== 'ACTIVE') return { outcome: 'denied', membership };
  if (!(await isWorkspaceActive(membership.workspaceId))) return { outcome: 'denied', membership };
  if (permission !== undefined && !roleHasPermission(membership.role, permission)) {
    return { outcome: 'forbidden', membership };
  }
  return { outcome: 'allow', membership };
}

export async function checkUserPermission(
  workspaceId: string,
  userId: string,
  permission: Permission,
): Promise<PermissionCheck> {
  return evaluateMembership(workspaceId, userId, permission);
}

export async function checkWorkspaceMembership(
  workspaceId: string,
  userId: string,
): Promise<PermissionCheck> {
  return evaluateMembership(workspaceId, userId);
}

export async function syncMembershipPermissions(memberId: Types.ObjectId | string): Promise<Permission[] | null> {
  const member = await WorkspaceMemberModel.findById(memberId);
  if (!member) return null;
  const permissions = permissionsForRole(member.role);
  member.permissions = permissions;
  await member.save();
  return permissions;
}

export async function setMembershipRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<MembershipSnapshot | null> {
  if (!Types.ObjectId.isValid(workspaceId) || !Types.ObjectId.isValid(userId)) return null;
  const member = await WorkspaceMemberModel.findOne({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: new Types.ObjectId(userId),
  });
  if (!member) return null;
  member.role = role;
  member.permissions = permissionsForRole(role);
  await member.save();
  return {
    workspaceId: member.workspaceId.toString(),
    userId: member.userId.toString(),
    role: member.role,
    status: member.status,
    permissions: permissionsForRole(member.role),
  };
}
