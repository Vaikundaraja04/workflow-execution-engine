import type { WorkspaceRole } from '../models/WorkspaceMemberModel.js';

export const PERMISSIONS = [
  'WORKFLOW_CREATE',
  'WORKFLOW_READ',
  'WORKFLOW_UPDATE',
  'WORKFLOW_DELETE',
  'WORKFLOW_EXECUTE',
  'MEMBER_MANAGE',
  'AUDIT_READ',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const TEMPLATE_PERMISSIONS = [
  'TEMPLATE_CREATE',
  'TEMPLATE_PUBLISH',
  'TEMPLATE_INSTALL',
  'TEMPLATE_MANAGE',
] as const;

export type TemplatePermission = (typeof TEMPLATE_PERMISSIONS)[number];

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'];

export const OWNER_ONLY_ACTIONS = [
  'workspace.transfer',
  'workspace.suspend',
  'workspace.delete',
  'member.remove-owner',
  'template.marketplace-approve',
] as const;

export type OwnerOnlyAction = (typeof OWNER_ONLY_ACTIONS)[number];

const EDITOR_PERMISSIONS: readonly Permission[] = [
  'WORKFLOW_CREATE',
  'WORKFLOW_READ',
  'WORKFLOW_UPDATE',
  'WORKFLOW_EXECUTE',
];

const VIEWER_PERMISSIONS: readonly Permission[] = ['WORKFLOW_READ'];

export const ROLE_PERMISSIONS: Record<WorkspaceRole, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  ADMIN: PERMISSIONS,
  EDITOR: EDITOR_PERMISSIONS,
  VIEWER: VIEWER_PERMISSIONS,
};

export const ROLE_TEMPLATE_PERMISSIONS: Record<WorkspaceRole, readonly TemplatePermission[]> = {
  OWNER: TEMPLATE_PERMISSIONS,
  ADMIN: TEMPLATE_PERMISSIONS,
  EDITOR: ['TEMPLATE_CREATE', 'TEMPLATE_INSTALL'],
  VIEWER: ['TEMPLATE_INSTALL'],
};

export function roleHasTemplatePermission(role: WorkspaceRole, permission: TemplatePermission): boolean {
  return ROLE_TEMPLATE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string' && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function permissionsForRole(role: WorkspaceRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function roleHasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function roleHasAllPermissions(role: WorkspaceRole, permissions: readonly Permission[]): boolean {
  return permissions.every((permission) => roleHasPermission(role, permission));
}

export function canPerformOwnerAction(role: WorkspaceRole, action: OwnerOnlyAction): boolean {
  return role === 'OWNER' && OWNER_ONLY_ACTIONS.includes(action);
}

export function permissionMatrix(): Record<WorkspaceRole, Permission[]> {
  const matrix = {} as Record<WorkspaceRole, Permission[]>;
  for (const role of WORKSPACE_ROLES) matrix[role] = permissionsForRole(role);
  return matrix;
}
