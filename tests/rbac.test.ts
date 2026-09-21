import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  WORKSPACE_ROLES,
  OWNER_ONLY_ACTIONS,
  canPerformOwnerAction,
  isPermission,
  isWorkspaceRole,
  permissionMatrix,
  permissionsForRole,
  roleHasAllPermissions,
  roleHasPermission,
} from '../src/auth/permissions.js';
import type { Permission } from '../src/auth/permissions.js';

const EXPECTED: Record<string, Permission[]> = {
  OWNER: [...PERMISSIONS],
  ADMIN: [...PERMISSIONS],
  EDITOR: ['WORKFLOW_CREATE', 'WORKFLOW_READ', 'WORKFLOW_UPDATE', 'WORKFLOW_EXECUTE', 'COLLABORATION_READ', 'COLLABORATION_COMMENT', 'OPERATIONS_READ', 'TEMPLATE_PUBLISH', 'GOVERNANCE_READ', 'AI_BUSINESS_READ', 'AGENT_READ', 'AGENT_EXECUTE', 'AGENT_TOOL_EXECUTE', 'AI_GOVERNANCE_READ', 'AI_MODEL_ROUTER_READ'],
  VIEWER: ['WORKFLOW_READ'],
};

function sorted(permissions: readonly Permission[]): string[] {
  return [...permissions].sort();
}

describe('Phase 3B role to permission matrix', () => {
  it('matches the documented matrix for every role', () => {
    for (const role of WORKSPACE_ROLES) {
      expect(sorted(permissionsForRole(role))).toEqual(sorted(EXPECTED[role] ?? []));
    }
  });

  it('grants every permission to OWNER and ADMIN', () => {
    expect(roleHasAllPermissions('OWNER', PERMISSIONS)).toBe(true);
    expect(roleHasAllPermissions('ADMIN', PERMISSIONS)).toBe(true);
    expect(permissionsForRole('OWNER')).toHaveLength(PERMISSIONS.length);
    expect(permissionsForRole('ADMIN')).toHaveLength(PERMISSIONS.length);
  });

  it('restricts EDITOR to create, read, update and execute', () => {
    expect(roleHasPermission('EDITOR', 'WORKFLOW_CREATE')).toBe(true);
    expect(roleHasPermission('EDITOR', 'WORKFLOW_READ')).toBe(true);
    expect(roleHasPermission('EDITOR', 'WORKFLOW_UPDATE')).toBe(true);
    expect(roleHasPermission('EDITOR', 'WORKFLOW_EXECUTE')).toBe(true);
    expect(roleHasPermission('EDITOR', 'WORKFLOW_DELETE')).toBe(false);
    expect(roleHasPermission('EDITOR', 'MEMBER_MANAGE')).toBe(false);
    expect(roleHasPermission('EDITOR', 'AUDIT_READ')).toBe(false);
  });

  it('restricts VIEWER to read only', () => {
    expect(permissionsForRole('VIEWER')).toEqual(['WORKFLOW_READ']);
    expect(roleHasPermission('VIEWER', 'WORKFLOW_CREATE')).toBe(false);
    expect(roleHasPermission('VIEWER', 'WORKFLOW_UPDATE')).toBe(false);
    expect(roleHasPermission('VIEWER', 'WORKFLOW_DELETE')).toBe(false);
    expect(roleHasPermission('VIEWER', 'WORKFLOW_EXECUTE')).toBe(false);
    expect(roleHasPermission('VIEWER', 'MEMBER_MANAGE')).toBe(false);
    expect(roleHasPermission('VIEWER', 'AUDIT_READ')).toBe(false);
  });

  it('keeps ownership transfer and workspace lifecycle actions owner-only', () => {
    for (const action of OWNER_ONLY_ACTIONS) {
      expect(canPerformOwnerAction('OWNER', action)).toBe(true);
      expect(canPerformOwnerAction('ADMIN', action)).toBe(false);
      expect(canPerformOwnerAction('EDITOR', action)).toBe(false);
      expect(canPerformOwnerAction('VIEWER', action)).toBe(false);
    }
  });

  it('returns defensive copies instead of the shared table', () => {
    const editor = permissionsForRole('EDITOR');
    editor.push('AUDIT_READ');
    expect(permissionsForRole('EDITOR')).not.toContain('AUDIT_READ');
    expect(ROLE_PERMISSIONS.EDITOR).not.toContain('AUDIT_READ');
  });

  it('validates permission and role values', () => {
    expect(isPermission('WORKFLOW_READ')).toBe(true);
    expect(isPermission('WORKFLOW_DESTROY')).toBe(false);
    expect(isPermission(undefined)).toBe(false);
    expect(isWorkspaceRole('EDITOR')).toBe(true);
    expect(isWorkspaceRole('SUPERADMIN')).toBe(false);
  });

  it('exposes the matrix for every role', () => {
    const matrix = permissionMatrix();
    expect(Object.keys(matrix).sort()).toEqual(['ADMIN', 'EDITOR', 'OWNER', 'VIEWER']);
    expect(matrix.VIEWER).toEqual(['WORKFLOW_READ']);
    expect(sorted(matrix.EDITOR)).toEqual(sorted(EXPECTED.EDITOR ?? []));
  });
});
