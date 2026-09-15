import { Types } from 'mongoose';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../models/WorkspaceMemberModel.js';
import type { MembershipStatus, WorkspaceRole } from '../models/WorkspaceMemberModel.js';
import { UserModel } from '../models/UserModel.js';
import { permissionsForRole } from '../auth/permissions.js';
import type { Permission } from '../auth/permissions.js';
import { createAuditLog } from './auditService.js';

export interface WorkspaceMemberView {
  id: string;
  workspaceId: string;
  userId: string;
  email?: string;
  role: WorkspaceRole;
  status: MembershipStatus;
  permissions: Permission[];
  invitedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InviteMemberInput {
  email?: string | undefined;
  userId?: string | undefined;
  role?: WorkspaceRole | undefined;
}

interface MemberShape {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: WorkspaceRole;
  status: MembershipStatus;
  permissions: Permission[];
  invitedBy?: Types.ObjectId | undefined | null;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_INVITE_ROLE: WorkspaceRole = 'VIEWER';

export function assertValidWorkspaceId(workspaceId: string): void {
  if (!Types.ObjectId.isValid(workspaceId)) throw new Error('INVALID_WORKSPACE_ID');
}

function toMemberView(member: MemberShape, email?: string | undefined): WorkspaceMemberView {
  const view: WorkspaceMemberView = {
    id: member._id.toString(),
    workspaceId: member.workspaceId.toString(),
    userId: member.userId.toString(),
    role: member.role,
    status: member.status,
    permissions: [...member.permissions],
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  };
  if (email !== undefined) view.email = email;
  if (member.invitedBy) view.invitedBy = member.invitedBy.toString();
  return view;
}

export async function requireWorkspace(workspaceId: string) {
  assertValidWorkspaceId(workspaceId);
  const workspace = await WorkspaceModel.findById(workspaceId);
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
  return workspace;
}

export async function getActiveMembership(workspaceId: string, userId: string) {
  const membership = await WorkspaceMemberModel.findOne({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: new Types.ObjectId(userId),
    status: 'ACTIVE',
  });
  if (!membership) throw new Error('WORKSPACE_NOT_FOUND');
  return membership;
}

export async function findTargetMembership(workspaceId: string, reference: string) {
  if (!Types.ObjectId.isValid(reference)) return null;
  const workspaceObjectId = new Types.ObjectId(workspaceId);
  const byId = await WorkspaceMemberModel.findOne({ _id: reference, workspaceId: workspaceObjectId });
  if (byId) return byId;
  return WorkspaceMemberModel.findOne({
    workspaceId: workspaceObjectId,
    userId: new Types.ObjectId(reference),
  });
}

async function lookupEmail(userId: Types.ObjectId): Promise<string | undefined> {
  const user = await UserModel.findById(userId).select('email');
  return user?.email;
}

export async function listMembers(workspaceId: string): Promise<WorkspaceMemberView[]> {
  assertValidWorkspaceId(workspaceId);
  const members = await WorkspaceMemberModel.find({ workspaceId: new Types.ObjectId(workspaceId) })
    .sort({ createdAt: 1 });
  const userIds = members.map((member) => member.userId);
  const users = await UserModel.find({ _id: { $in: userIds } }).select('email');
  const emailById = new Map(users.map((user) => [user._id.toString(), user.email]));
  return members.map((member) => toMemberView(member, emailById.get(member.userId.toString())));
}

async function resolveInviteTarget(input: InviteMemberInput) {
  if (input.userId !== undefined) {
    if (!Types.ObjectId.isValid(input.userId)) throw new Error('USER_NOT_FOUND');
    const user = await UserModel.findById(input.userId);
    if (!user) throw new Error('USER_NOT_FOUND');
    return user;
  }
  if (input.email === undefined) throw new Error('USER_NOT_FOUND');
  const user = await UserModel.findOne({ email: input.email.trim().toLowerCase() });
  if (!user) throw new Error('USER_NOT_FOUND');
  return user;
}

export async function inviteMember(
  workspaceId: string,
  actorId: string,
  input: InviteMemberInput,
): Promise<WorkspaceMemberView> {
  await requireWorkspace(workspaceId);
  const user = await resolveInviteTarget(input);
  const role = input.role ?? DEFAULT_INVITE_ROLE;
  if (role === 'OWNER') throw new Error('OWNER_ROLE_IMMUTABLE');

  const workspaceObjectId = new Types.ObjectId(workspaceId);
  const permissions = permissionsForRole(role);
  const existing = await WorkspaceMemberModel.findOne({
    workspaceId: workspaceObjectId,
    userId: user._id,
  });
  if (existing && existing.status !== 'REMOVED') throw new Error('MEMBER_ALREADY_EXISTS');

  let membership;
  if (existing) {
    existing.role = role;
    existing.status = 'INVITED';
    existing.invitedBy = new Types.ObjectId(actorId);
    existing.permissions = permissions;
    membership = await existing.save();
  } else {
    membership = await WorkspaceMemberModel.create({
      workspaceId: workspaceObjectId,
      userId: user._id,
      role,
      status: 'INVITED',
      invitedBy: new Types.ObjectId(actorId),
      permissions,
    });
  }

  await createAuditLog({
    action: 'WORKSPACE_MEMBER_INVITED',
    userId: actorId,
    workspaceId,
    resource: 'member',
    resourceId: membership._id.toString(),
    metadata: { role, invitedUserId: user._id.toString() },
  });
  return toMemberView(membership, user.email);
}

export async function updateMemberRole(
  workspaceId: string,
  actorId: string,
  reference: string,
  role: WorkspaceRole,
): Promise<WorkspaceMemberView> {
  assertValidWorkspaceId(workspaceId);
  const target = await findTargetMembership(workspaceId, reference);
  if (!target) throw new Error('MEMBER_NOT_FOUND');
  if (role === 'OWNER') throw new Error('OWNER_ROLE_IMMUTABLE');
  if (target.role === 'OWNER') {
    const actor = await getActiveMembership(workspaceId, actorId);
    if (actor.role !== 'OWNER') throw new Error('FORBIDDEN');
    throw new Error('OWNER_ROLE_IMMUTABLE');
  }

  const previousRole = target.role;
  target.role = role;
  target.permissions = permissionsForRole(role);
  await target.save();
  await createAuditLog({
    action: 'WORKSPACE_MEMBER_ROLE_CHANGED',
    userId: actorId,
    workspaceId,
    resource: 'member',
    resourceId: target._id.toString(),
    metadata: { previousRole, role },
  });
  return toMemberView(target, await lookupEmail(target.userId));
}

export async function removeMember(
  workspaceId: string,
  actorId: string,
  reference: string,
): Promise<WorkspaceMemberView> {
  assertValidWorkspaceId(workspaceId);
  const target = await findTargetMembership(workspaceId, reference);
  if (!target || target.status === 'REMOVED') throw new Error('MEMBER_NOT_FOUND');
  if (target.role === 'OWNER') {
    const actor = await getActiveMembership(workspaceId, actorId);
    if (actor.role !== 'OWNER') throw new Error('FORBIDDEN');
    throw new Error('OWNER_ROLE_IMMUTABLE');
  }

  const previousRole = target.role;
  target.status = 'REMOVED';
  await target.save();
  await createAuditLog({
    action: 'WORKSPACE_MEMBER_REMOVED',
    userId: actorId,
    workspaceId,
    resource: 'member',
    resourceId: target._id.toString(),
    metadata: { previousRole },
  });
  return toMemberView(target, await lookupEmail(target.userId));
}

export async function acceptInvitation(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMemberView> {
  await requireWorkspace(workspaceId);
  const membership = await WorkspaceMemberModel.findOne({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: new Types.ObjectId(userId),
  });
  if (!membership || membership.status !== 'INVITED') throw new Error('INVITATION_NOT_FOUND');

  membership.status = 'ACTIVE';
  membership.permissions = permissionsForRole(membership.role);
  await membership.save();
  await createAuditLog({
    action: 'WORKSPACE_MEMBER_JOINED',
    userId,
    workspaceId,
    resource: 'member',
    resourceId: membership._id.toString(),
    metadata: { role: membership.role },
  });
  return toMemberView(membership, await lookupEmail(membership.userId));
}

export async function isWorkspaceOwner(workspaceId: string, userId: string): Promise<boolean> {
  const membership = await WorkspaceMemberModel.findOne({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: new Types.ObjectId(userId),
    status: 'ACTIVE',
  });
  return membership?.role === 'OWNER';
}
