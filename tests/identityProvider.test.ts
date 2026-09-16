import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { IdentityProviderModel } from '../src/models/IdentityProviderModel.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import type { WorkspaceRole } from '../src/models/WorkspaceMemberModel.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

interface Session {
  id: string;
  email: string;
  token: string;
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  request = supertest(createApp({
    auth: authConfig,
    authRateLimit: { loginLimit: 1000, refreshLimit: 1000 },
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

async function createUser(email: string): Promise<Session> {
  const user = await UserModel.create({ email, passwordHash: 'not-used' });
  const id = user._id.toString();
  return { id, email, token: signAccessToken(authConfig, { userId: id, email }) };
}

async function createWorkspace(userId: string, name: string = 'Test Workspace'): Promise<string> {
  const slug = (name + '-' + userId).toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 64);
  const workspace = await WorkspaceModel.create({
    name,
    slug,
    ownerId: new Types.ObjectId(userId),
  });
  return workspace._id.toString();
}

async function addMember(workspaceId: string, userId: string, role: WorkspaceRole = 'ADMIN'): Promise<void> {
  await WorkspaceMemberModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: new Types.ObjectId(userId),
    role,
    status: 'ACTIVE',
  });
}

describe('Identity Provider Management', () => {
  let adminSession: Session;
  let workspaceId: string;

  beforeEach(async () => {
    // Clean up collections
    await IdentityProviderModel.deleteMany({});
    await WorkspaceModel.deleteMany({});
    await WorkspaceMemberModel.deleteMany({});
    await UserModel.deleteMany({});

    // Create admin user and workspace
    adminSession = await createUser('admin@test.com');
    workspaceId = await createWorkspace(adminSession.id, 'Test Workspace');
    await addMember(workspaceId, adminSession.id, 'ADMIN');
  });

  describe('GET /api/v1/admin/workspaces/:workspaceId/identity-providers', () => {
    it('should return empty list when no providers exist', async () => {
      const res = await request
        .get(`/api/v1/admin/workspaces/${workspaceId}/identity-providers`)
        .set(authHeader(adminSession.token))
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should return list of providers', async () => {
      // Create two providers
      await IdentityProviderModel.create({
        workspaceId: new Types.ObjectId(workspaceId),
        type: 'OIDC',
        name: 'Google',
        status: 'ACTIVE',
        issuer: 'https://accounts.google.com',
        clientId: 'google-client-id',
        clientSecretEncrypted: 'encrypted-secret',
        domains: ['google.com'],
        domainVerificationStatus: 'VERIFIED',
        enforceSSO: false,
        allowPasswordFallback: true,
        createdBy: new Types.ObjectId(adminSession.id),
      });

      await IdentityProviderModel.create({
        workspaceId: new Types.ObjectId(workspaceId),
        type: 'SAML',
        name: 'Azure AD',
        status: 'ACTIVE',
        issuer: 'https://sts.windows.net/xxxxxxx/',
        clientId: 'azure-client-id',
        clientSecretEncrypted: 'encrypted-secret',
        domains: ['company.com'],
        domainVerificationStatus: 'PENDING',
        enforceSSO: true,
        allowPasswordFallback: false,
        createdBy: new Types.ObjectId(adminSession.id),
      });

      const res = await request
        .get(`/api/v1/admin/workspaces/${workspaceId}/identity-providers`)
        .set(authHeader(adminSession.token))
        .expect(200);

      expect(res.body).toHaveLength(2);
      const names = res.body.map((p: any) => p.name);
      expect(names).toContain('Google');
      expect(names).toContain('Azure AD');
    });
  });

  describe('POST /api/v1/admin/workspaces/:workspaceId/identity-providers', () => {
    it('should create a new OIDC provider', async () => {
      const providerData = {
        type: 'OIDC',
        name: 'GitHub',
        issuer: 'https://github.com',
        clientId: 'github-client-id',
        clientSecret: 'github-client-secret',
        domains: ['github.com'],
        domainVerificationStatus: 'PENDING',
        enforceSSO: true,
        allowPasswordFallback: false,
        roleMapping: {
          'admin': 'ADMIN',
          'member': 'EDITOR',
          'read': 'VIEWER'
        }
      };

      const res = await request
        .post(`/api/v1/admin/workspaces/${workspaceId}/identity-providers`)
        .set(authHeader(adminSession.token))
        .send(providerData)
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'GitHub',
        type: 'OIDC',
        issuer: 'https://github.com',
        clientId: 'github-client-id',
        enforceSSO: true,
        allowPasswordFallback: false,
        domains: ['github.com'],
      });

      // Verify in database
      const provider = await IdentityProviderModel.findOne({ name: 'GitHub' });
      expect(provider).toBeTruthy();
      expect(provider?.status).toBe('ACTIVE');
      expect(provider?.roleMapping).toEqual({
        'admin': 'ADMIN',
        'member': 'EDITOR',
        'read': 'VIEWER'
      });
    });

    it('should reject invalid provider data', async () => {
      const invalidData = {
        type: 'OIDC',
        // missing required fields
      };

      await request
        .post(`/api/v1/admin/workspaces/${workspaceId}/identity-providers`)
        .set(authHeader(adminSession.token))
        .send(invalidData)
        .expect(400);
    });
  });

  describe('PATCH /api/v1/admin/workspaces/:workspaceId/identity-providers/:providerId', () => {
    let providerId: string;

    beforeEach(async () => {
      const provider = await IdentityProviderModel.create({
        workspaceId: new Types.ObjectId(workspaceId),
        type: 'OIDC',
        name: 'Original Name',
        status: 'ACTIVE',
        issuer: 'https://original.com',
        clientId: 'original-client-id',
        clientSecretEncrypted: 'encrypted-secret',
        domains: ['original.com'],
        domainVerificationStatus: 'PENDING',
        enforceSSO: false,
        allowPasswordFallback: true,
        createdBy: new Types.ObjectId(adminSession.id),
      });
      providerId = provider._id.toString();
    });

    it('should update provider fields', async () => {
      const updateData = {
        name: 'Updated Name',
        issuer: 'https://updated.com',
        enforceSSO: true,
        allowPasswordFallback: false,
        domains: ['updated.com', 'another.com'],
      };

      const res = await request
        .patch(`/api/v1/admin/workspaces/${workspaceId}/identity-providers/${providerId}`)
        .set(authHeader(adminSession.token))
        .send(updateData)
        .expect(200);

      expect(res.body.name).toBe('Updated Name');
      expect(res.body.issuer).toBe('https://updated.com');
      expect(res.body.enforceSSO).toBe(true);
      expect(res.body.allowPasswordFallback).toBe(false);
      expect(res.body.domains).toEqual(['updated.com', 'another.com']);
    });

    it('should handle client secret update', async () => {
      const updateData = {
        clientSecret: 'new-client-secret',
      };

      const res = await request
        .patch(`/api/v1/admin/workspaces/${workspaceId}/identity-providers/${providerId}`)
        .set(authHeader(adminSession.token))
        .send(updateData)
        .expect(200);

      // Note: client secret is not returned in response for security
      expect(res.body).not.toHaveProperty('clientSecretEncrypted');

      // Verify in database that secret was updated (we can't decrypt it in test, but we can verify it's stored)
      const provider = await IdentityProviderModel.findById(providerId).select('+clientSecretEncrypted');
      expect(provider?.clientSecretEncrypted).toBeDefined();
      expect(provider?.clientSecretEncrypted).not.toBe('encrypted-secret'); // Should be different
    });
  });

  describe('DELETE /api/v1/admin/workspaces/:workspaceId/identity-providers/:providerId', () => {
    let providerId: string;

    beforeEach(async () => {
      const provider = await IdentityProviderModel.create({
        workspaceId: new Types.ObjectId(workspaceId),
        type: 'OIDC',
        name: 'To Be Deleted',
        status: 'ACTIVE',
        issuer: 'https://todelete.com',
        clientId: 'delete-client-id',
        clientSecretEncrypted: 'encrypted-secret',
        domains: ['todelete.com'],
        domainVerificationStatus: 'PENDING',
        enforceSSO: false,
        allowPasswordFallback: true,
        createdBy: new Types.ObjectId(adminSession.id),
      });
      providerId = provider._id.toString();
    });

    it('should disable provider (soft delete)', async () => {
      const res = await request
        .delete(`/api/v1/admin/workspaces/${workspaceId}/identity-providers/${providerId}`)
        .set(authHeader(adminSession.token))
        .expect(200);

      expect(res.body.message).toBe('Identity provider disabled successfully');

      // Verify provider is disabled but not deleted
      const provider = await IdentityProviderModel.findById(providerId);
      expect(provider).toBeTruthy();
      expect(provider?.status).toBe('DISABLED');
    });
  });

  describe('Authorization', () => {
    let regularUserSession: Session;

    beforeEach(async () => {
      regularUserSession = await createUser('user@test.com');
      await addMember(workspaceId, regularUserSession.id, 'VIEWER');
    });

    it('should deny access to non-MEMBER_MANAGE users', async () => {
      await request
        .get(`/api/v1/admin/workspaces/${workspaceId}/identity-providers`)
        .set(authHeader(regularUserSession.token))
        .expect(403);
    });
  });
});