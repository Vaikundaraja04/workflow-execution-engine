import {
  PERMISSIONS,
  SECURITY_PERMISSIONS,
  roleHasPermission,
  roleHasAllPermissions,
  isSecurityPermission,
  permissionsForRole,
} from '../src/auth/permissions.js';
import { describe, it, expect } from 'vitest';

describe('Phase 8 RBAC & Security Permissions', () => {
  describe('Security Permission Constants & Checks', () => {
    it('should include all required Phase 8 security permissions in PERMISSIONS', () => {
      expect(PERMISSIONS).toContain('SECURITY_READ');
      expect(PERMISSIONS).toContain('SECURITY_MANAGE');
      expect(PERMISSIONS).toContain('COMPLIANCE_EXPORT');
      expect(PERMISSIONS).toContain('PRIVACY_MANAGE');
      expect(PERMISSIONS).toContain('SECRETS_MANAGE');
    });

    it('should correctly identify valid security permissions with isSecurityPermission', () => {
      expect(isSecurityPermission('SECURITY_READ')).toBe(true);
      expect(isSecurityPermission('SECURITY_MANAGE')).toBe(true);
      expect(isSecurityPermission('COMPLIANCE_EXPORT')).toBe(true);
      expect(isSecurityPermission('PRIVACY_MANAGE')).toBe(true);
      expect(isSecurityPermission('SECRETS_MANAGE')).toBe(true);
      expect(isSecurityPermission('WORKFLOW_CREATE')).toBe(false);
      expect(isSecurityPermission('INVALID_PERMISSION')).toBe(false);
    });
  });

  describe('Role-based Security Access', () => {
    it('OWNER role should have all security and compliance permissions', () => {
      const ownerPerms = permissionsForRole('OWNER');
      for (const perm of SECURITY_PERMISSIONS) {
        expect(ownerPerms).toContain(perm);
        expect(roleHasPermission('OWNER', perm)).toBe(true);
      }
      expect(roleHasAllPermissions('OWNER', SECURITY_PERMISSIONS)).toBe(true);
    });

    it('ADMIN role should have all security and compliance permissions', () => {
      const adminPerms = permissionsForRole('ADMIN');
      for (const perm of SECURITY_PERMISSIONS) {
        expect(adminPerms).toContain(perm);
        expect(roleHasPermission('ADMIN', perm)).toBe(true);
      }
      expect(roleHasAllPermissions('ADMIN', SECURITY_PERMISSIONS)).toBe(true);
    });

    it('EDITOR role should not have administrative security permissions', () => {
      expect(roleHasPermission('EDITOR', 'SECURITY_READ')).toBe(false);
      expect(roleHasPermission('EDITOR', 'SECURITY_MANAGE')).toBe(false);
      expect(roleHasPermission('EDITOR', 'COMPLIANCE_EXPORT')).toBe(false);
      expect(roleHasPermission('EDITOR', 'PRIVACY_MANAGE')).toBe(false);
      expect(roleHasPermission('EDITOR', 'SECRETS_MANAGE')).toBe(false);
    });

    it('VIEWER role should not have administrative security permissions', () => {
      expect(roleHasPermission('VIEWER', 'SECURITY_READ')).toBe(false);
      expect(roleHasPermission('VIEWER', 'SECURITY_MANAGE')).toBe(false);
      expect(roleHasPermission('VIEWER', 'COMPLIANCE_EXPORT')).toBe(false);
      expect(roleHasPermission('VIEWER', 'PRIVACY_MANAGE')).toBe(false);
      expect(roleHasPermission('VIEWER', 'SECRETS_MANAGE')).toBe(false);
    });
  });
});
