import type { WorkspaceRole } from '../models/WorkspaceMemberModel.js';

export const PERMISSIONS = [
  'WORKFLOW_CREATE',
  'WORKFLOW_READ',
  'WORKFLOW_UPDATE',
  'WORKFLOW_DELETE',
  'WORKFLOW_EXECUTE',
  'MEMBER_MANAGE',
  'AUDIT_READ',
  'COLLABORATION_READ',
  'COLLABORATION_COMMENT',
  'COLLABORATION_MANAGE',
  'SECURITY_READ',
  'SECURITY_MANAGE',
  'COMPLIANCE_EXPORT',
  'PRIVACY_MANAGE',
  'SECRETS_MANAGE',
  'OPERATIONS_READ',
  'OPERATIONS_MANAGE',
  // Marketplace
  'TEMPLATE_PUBLISH',
  'TEMPLATE_MANAGE',
  // Governance
  'GOVERNANCE_READ',
  'GOVERNANCE_MANAGE',
  // Tenant Management
  'TENANT_MANAGE',
  // AI Business Intelligence
  'AI_BUSINESS_READ',
  'AI_BUSINESS_EXECUTE',
  // Self-Healing
  'SELF_HEALING_READ',
  'SELF_HEALING_MANAGE',
  // Agent Framework
  'AGENT_READ',
  'AGENT_EXECUTE',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SECURITY_PERMISSIONS = [
  'SECURITY_READ',
  'SECURITY_MANAGE',
  'COMPLIANCE_EXPORT',
  'PRIVACY_MANAGE',
  'SECRETS_MANAGE',
] as const;

export type SecurityPermission = (typeof SECURITY_PERMISSIONS)[number];

export const TEMPLATE_PERMISSIONS = [
  'TEMPLATE_CREATE',
  'TEMPLATE_PUBLISH',
  'TEMPLATE_INSTALL',
  'TEMPLATE_MANAGE',
] as const;

export type TemplatePermission = (typeof TEMPLATE_PERMISSIONS)[number];

export const AI_PERMISSIONS = [
  'AI_WORKFLOW_CREATE',
  'AI_ANALYSIS_READ',
  'AI_OPTIMIZATION_CREATE',
  'AI_CONFIGURATION_MANAGE',
  'AI_OPERATIONS_READ',
  'AI_OPERATIONS_EXECUTE',
  'AI_BUSINESS_READ',
  'AI_BUSINESS_EXECUTE',
] as const;

export type AIPermission = (typeof AI_PERMISSIONS)[number];

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
  'COLLABORATION_READ',
  'COLLABORATION_COMMENT',
  'OPERATIONS_READ',
  'TEMPLATE_PUBLISH',
  'GOVERNANCE_READ',
  'AI_BUSINESS_READ',
  'AGENT_READ',
  'AGENT_EXECUTE',
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
  EDITOR: ['TEMPLATE_CREATE', 'TEMPLATE_INSTALL', 'TEMPLATE_PUBLISH'],
  VIEWER: ['TEMPLATE_INSTALL'],
};

export const ROLE_AI_PERMISSIONS: Record<WorkspaceRole, readonly AIPermission[]> = {
  OWNER: AI_PERMISSIONS,
  ADMIN: AI_PERMISSIONS,
  EDITOR: [
    'AI_WORKFLOW_CREATE',
    'AI_OPTIMIZATION_CREATE',
    'AI_ANALYSIS_READ',
    'AI_OPERATIONS_READ',
    'AI_OPERATIONS_EXECUTE',
    'AI_BUSINESS_READ',
    'AI_BUSINESS_EXECUTE',
  ],
  VIEWER: ['AI_ANALYSIS_READ', 'AI_OPERATIONS_READ', 'AI_BUSINESS_READ'],
};

export function roleHasTemplatePermission(role: WorkspaceRole, permission: TemplatePermission): boolean {
  return ROLE_TEMPLATE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function roleHasAiPermission(role: WorkspaceRole, permission: AIPermission): boolean {
  return ROLE_AI_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

export function isTemplatePermission(value: unknown): value is TemplatePermission {
  return typeof value === 'string' && (TEMPLATE_PERMISSIONS as readonly string[]).includes(value as TemplatePermission);
}

export function isAiPermission(value: unknown): value is AIPermission {
  return typeof value === 'string' && (AI_PERMISSIONS as readonly string[]).includes(value as AIPermission);
}

export function isSecurityPermission(value: unknown): value is SecurityPermission {
  return typeof value === 'string' && (SECURITY_PERMISSIONS as readonly string[]).includes(value as SecurityPermission);
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string' && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function permissionsForRole(role: WorkspaceRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function aiPermissionsForRole(role: WorkspaceRole): AIPermission[] {
  return [...ROLE_AI_PERMISSIONS[role]];
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
