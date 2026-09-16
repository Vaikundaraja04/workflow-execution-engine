import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { SCIMTokenModel } from '../src/models/SCIMTokenModel.js';
import { createSCIMToken } from '../src/services/scimService.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  request = supertest(
    createApp({
      auth: authConfig,
      authRateLimit: { loginLimit: 1000, refreshLimit: 1000 },
    }),
  );
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

describe('SCIM 2.0 Inbound Provisioning API', () => {
  let workspaceId: string;
  let ownerUserId: string;
  let ownerToken: string;
  let scimBearerToken: string;

  beforeEach(async () => {
    await SCIMTokenModel.deleteMany({});
    await WorkspaceModel.deleteMany({});
    await WorkspaceMemberModel.deleteMany({});
    await UserModel.deleteMany({});

    // Create Owner User
    const owner = await UserModel.create({
      email: 'owner@enterprise.io',
      passwordHash: 'some-hash',
    });
    ownerUserId = owner._id.toString();
    ownerToken = signAccessToken(authConfig, { userId: ownerUserId, email: owner.email });

    // Create Workspace
    const ws = await WorkspaceModel.create({
      name: 'Enterprise Inc',
      slug: 'enterprise-inc-' + ownerUserId.substring(0, 8),
      ownerId: new Types.ObjectId(ownerUserId),
    });
    workspaceId = ws._id.toString();

    await WorkspaceMemberModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(ownerUserId),
      role: 'OWNER',
      status: 'ACTIVE',
    });

    // Generate SCIM Bearer token
    const tokenRes = await createSCIMToken(workspaceId, ownerUserId, 'Okta Provisioning');
    scimBearerToken = tokenRes.token;
  });

  describe('GET /scim/v2/ServiceProviderConfig', () => {
    it('should return standard SCIM 2.0 ServiceProviderConfig JSON', async () => {
      const res = await request
        .get('/scim/v2/ServiceProviderConfig')
        .expect(200);

      expect(res.headers['content-type']).toContain('application/scim+json');
      expect(res.body.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig');
      expect(res.body.patch.supported).toBe(true);
      expect(res.body.bulk.supported).toBe(false);
      expect(res.body.filter.supported).toBe(true);
    });
  });

  describe('SCIM Authentication', () => {
    it('should reject requests without SCIM Bearer token', async () => {
      await request
        .get('/scim/v2/Users')
        .expect(401);
    });

    it('should reject requests with invalid SCIM token', async () => {
      await request
        .get('/scim/v2/Users')
        .set('Authorization', 'Bearer invalid_scim_token')
        .expect(401);
    });

    it('should allow requests with valid SCIM Bearer token', async () => {
      const res = await request
        .get('/scim/v2/Users')
        .set('Authorization', `Bearer ${scimBearerToken}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/scim+json');
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(res.body.totalResults).toBe(1); // The workspace owner
    });
  });

  describe('User Provisioning Lifecycle', () => {
    let provisionedUserId: string;

    it('POST /scim/v2/Users - should provision new user in workspace', async () => {
      const payload = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'john.doe@enterprise.io',
        emails: [{ value: 'john.doe@enterprise.io', primary: true }],
        name: { givenName: 'John', familyName: 'Doe' },
        active: true,
        roles: [{ value: 'EDITOR', primary: true }],
      };

      const res = await request
        .post('/scim/v2/Users')
        .set('Authorization', `Bearer ${scimBearerToken}`)
        .send(payload)
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.userName).toBe('john.doe@enterprise.io');
      expect(res.body.active).toBe(true);
      expect(res.body.roles[0].value).toBe('EDITOR');

      provisionedUserId = res.body.id;

      // Verify membership in database
      const member = await WorkspaceMemberModel.findOne({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: new Types.ObjectId(provisionedUserId),
      });
      expect(member).toBeTruthy();
      expect(member?.role).toBe('EDITOR');
      expect(member?.status).toBe('ACTIVE');
    });

    it('POST /scim/v2/Users - should clamp OWNER role request to ADMIN for safety', async () => {
      const payload = {
        userName: 'hacker@enterprise.io',
        emails: [{ value: 'hacker@enterprise.io', primary: true }],
        roles: [{ value: 'OWNER', primary: true }],
      };

      const res = await request
        .post('/scim/v2/Users')
        .set('Authorization', `Bearer ${scimBearerToken}`)
        .send(payload)
        .expect(201);

      expect(res.body.roles[0].value).toBe('ADMIN');

      const member = await WorkspaceMemberModel.findOne({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: new Types.ObjectId(res.body.id),
      });
      expect(member?.role).toBe('ADMIN');
    });

    it('GET /scim/v2/Users/:id - should fetch user by SCIM ID', async () => {
      const res = await request
        .get(`/scim/v2/Users/${ownerUserId}`)
        .set('Authorization', `Bearer ${scimBearerToken}`)
        .expect(200);

      expect(res.body.id).toBe(ownerUserId);
      expect(res.body.userName).toBe('owner@enterprise.io');
      expect(res.body.active).toBe(true);
    });

    it('GET /scim/v2/Users?filter= - should filter user by email/userName', async () => {
      const res = await request
        .get('/scim/v2/Users?filter=userName eq "owner@enterprise.io"')
        .set('Authorization', `Bearer ${scimBearerToken}`)
        .expect(200);

      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].id).toBe(ownerUserId);
    });

    it('PATCH /scim/v2/Users/:id - should update user status and role', async () => {
      // Create user first
      const user = await UserModel.create({
        email: 'sarah@enterprise.io',
        passwordHash: 'hash',
      });
      await WorkspaceMemberModel.create({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: user._id,
        role: 'VIEWER',
        status: 'ACTIVE',
      });

      // Update via SCIM PATCH
      const patchPayload = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', path: 'roles', value: [{ value: 'ADMIN' }] },
          { op: 'replace', path: 'active', value: false },
        ],
      };

      const res = await request
        .patch(`/scim/v2/Users/${user._id.toString()}`)
        .set('Authorization', `Bearer ${scimBearerToken}`)
        .send(patchPayload)
        .expect(200);

      expect(res.body.active).toBe(false);
      expect(res.body.roles[0].value).toBe('ADMIN');

      const member = await WorkspaceMemberModel.findOne({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: user._id,
      });
      expect(member?.status).toBe('REMOVED');
      expect(member?.role).toBe('ADMIN');
    });

    it('DELETE /scim/v2/Users/:id - should deprovision member from workspace', async () => {
      const user = await UserModel.create({
        email: 'alex@enterprise.io',
        passwordHash: 'hash',
      });
      await WorkspaceMemberModel.create({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: user._id,
        role: 'EDITOR',
        status: 'ACTIVE',
      });

      await request
        .delete(`/scim/v2/Users/${user._id.toString()}`)
        .set('Authorization', `Bearer ${scimBearerToken}`)
        .expect(204);

      const member = await WorkspaceMemberModel.findOne({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: user._id,
      });
      expect(member?.status).toBe('REMOVED');
    });

    it('DELETE /scim/v2/Users/:id - cannot deprovision workspace OWNER', async () => {
      const res = await request
        .delete(`/scim/v2/Users/${ownerUserId}`)
        .set('Authorization', `Bearer ${scimBearerToken}`)
        .expect(403);

      expect(res.body.detail).toContain('OWNER');
    });
  });

  describe('SCIM Token Admin Management Endpoints', () => {
    it('POST /api/v1/admin/workspaces/:workspaceId/scim-tokens - creates SCIM token', async () => {
      const res = await request
        .post(`/api/v1/admin/workspaces/${workspaceId}/scim-tokens`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ description: 'Azure AD SCIM Integration', expiresInDays: 180 })
        .expect(201);

      expect(res.body).toHaveProperty('token');
      expect(res.body.token).toMatch(/^scim_/);
      expect(res.body).toHaveProperty('prefix');
    });

    it('GET /api/v1/admin/workspaces/:workspaceId/scim-tokens - lists SCIM tokens', async () => {
      const res = await request
        .get(`/api/v1/admin/workspaces/${workspaceId}/scim-tokens`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0]).toHaveProperty('prefix');
      expect(res.body[0]).not.toHaveProperty('tokenHash');
    });

    it('DELETE /api/v1/admin/workspaces/:workspaceId/scim-tokens/:tokenId - revokes SCIM token', async () => {
      const token = await SCIMTokenModel.findOne({ workspaceId: new Types.ObjectId(workspaceId) });
      expect(token).toBeTruthy();

      await request
        .delete(`/api/v1/admin/workspaces/${workspaceId}/scim-tokens/${token!._id.toString()}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const updated = await SCIMTokenModel.findById(token!._id);
      expect(updated?.status).toBe('REVOKED');
    });
  });
});
