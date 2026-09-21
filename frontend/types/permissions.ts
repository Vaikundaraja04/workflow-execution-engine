import { WorkspaceRole } from './workspace';

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

export const AI_PERMISSIONS = [
  'AI_WORKFLOW_CREATE',
  'AI_ANALYSIS_READ',
  'AI_OPTIMIZATION_CREATE',
  'AI_OPTIMIZATION_READ',
  'AI_OPTIMIZATION_APPROVE',
  'AI_CONFIGURATION_MANAGE',
] as const;

export type AIPermission = (typeof AI_PERMISSIONS)[number];

// Phase 12 — AI-Native Automation & Autonomous Operations permissions.
// Mirrors the backend matrices in `src/auth/permissions.ts`.
export const AI_OPERATIONS_PERMISSIONS = [
  'OPERATIONS_READ',
  'OPERATIONS_MANAGE',
  'SELF_HEALING_READ',
  'SELF_HEALING_MANAGE',
  'AGENT_READ',
  'AGENT_EXECUTE',
  'AGENT_TOOL_EXECUTE',
  'AGENT_MANAGE',
  'AI_GOVERNANCE_READ',
  'AI_GOVERNANCE_MANAGE',
  'AI_MODEL_ROUTER_READ',
  'AI_MODEL_ROUTER_MANAGE',
] as const;

export type AIOperationsPermission = (typeof AI_OPERATIONS_PERMISSIONS)[number];

// Phase 12.7 — Enterprise AI Agent Marketplace permissions.
export const AGENT_MARKETPLACE_PERMISSIONS = [
  'AGENT_MARKETPLACE_READ',
  'AGENT_MARKETPLACE_CREATE',
  'AGENT_MARKETPLACE_MANAGE',
  'AGENT_INSTALL',
] as const;

export type AgentMarketplacePermission = (typeof AGENT_MARKETPLACE_PERMISSIONS)[number];

export type AnyPermission =
  | Permission
  | TemplatePermission
  | AIPermission
  | AIOperationsPermission
  | AgentMarketplacePermission;

export const ROLE_PERMISSIONS: Record<WorkspaceRole, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  ADMIN: PERMISSIONS,
  EDITOR: [
    'WORKFLOW_CREATE',
    'WORKFLOW_READ',
    'WORKFLOW_UPDATE',
    'WORKFLOW_EXECUTE',
  ],
  VIEWER: ['WORKFLOW_READ'],
};

export const ROLE_TEMPLATE_PERMISSIONS: Record<WorkspaceRole, readonly TemplatePermission[]> = {
  OWNER: TEMPLATE_PERMISSIONS,
  ADMIN: TEMPLATE_PERMISSIONS,
  EDITOR: ['TEMPLATE_CREATE', 'TEMPLATE_INSTALL'],
  VIEWER: ['TEMPLATE_INSTALL'],
};

export const ROLE_AI_PERMISSIONS: Record<WorkspaceRole, readonly AIPermission[]> = {
  OWNER: AI_PERMISSIONS,
  ADMIN: AI_PERMISSIONS,
  EDITOR: ['AI_WORKFLOW_CREATE', 'AI_OPTIMIZATION_CREATE', 'AI_OPTIMIZATION_READ', 'AI_ANALYSIS_READ'],
  VIEWER: ['AI_OPTIMIZATION_READ', 'AI_ANALYSIS_READ'],
};

export const ROLE_AI_OPERATIONS_PERMISSIONS: Record<
  WorkspaceRole,
  readonly AIOperationsPermission[]
> = {
  OWNER: AI_OPERATIONS_PERMISSIONS,
  ADMIN: AI_OPERATIONS_PERMISSIONS,
    EDITOR: [
    'OPERATIONS_READ',
    'AGENT_READ',
    'AGENT_EXECUTE',
    'AGENT_TOOL_EXECUTE',
    'AI_GOVERNANCE_READ',
    'AI_MODEL_ROUTER_READ',
  ],
      VIEWER: ['AI_GOVERNANCE_READ', 'AI_MODEL_ROUTER_READ'],
};

export const ROLE_AGENT_MARKETPLACE_PERMISSIONS: Record<
  WorkspaceRole,
  readonly AgentMarketplacePermission[]
> = {
  OWNER: AGENT_MARKETPLACE_PERMISSIONS,
  ADMIN: AGENT_MARKETPLACE_PERMISSIONS,
  EDITOR: ['AGENT_MARKETPLACE_READ', 'AGENT_INSTALL'],
  VIEWER: ['AGENT_MARKETPLACE_READ'],
};

export function hasPermission(role: WorkspaceRole | undefined | null, permission: AnyPermission): boolean {
  if (!role) return false;

  if ((PERMISSIONS as readonly string[]).includes(permission)) {
    return ROLE_PERMISSIONS[role]?.includes(permission as Permission) ?? false;
  }
  if ((TEMPLATE_PERMISSIONS as readonly string[]).includes(permission)) {
    return ROLE_TEMPLATE_PERMISSIONS[role]?.includes(permission as TemplatePermission) ?? false;
  }
  if ((AI_PERMISSIONS as readonly string[]).includes(permission)) {
    return ROLE_AI_PERMISSIONS[role]?.includes(permission as AIPermission) ?? false;
  }
  if ((AI_OPERATIONS_PERMISSIONS as readonly string[]).includes(permission)) {
    return (
      ROLE_AI_OPERATIONS_PERMISSIONS[role]?.includes(permission as AIOperationsPermission) ?? false
    );
  }
  if ((AGENT_MARKETPLACE_PERMISSIONS as readonly string[]).includes(permission)) {
    return (
      ROLE_AGENT_MARKETPLACE_PERMISSIONS[role]?.includes(permission as AgentMarketplacePermission) ?? false
    );
  }
  return false;
}
