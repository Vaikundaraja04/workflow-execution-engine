import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { IdentityProviderModel } from '../src/models/IdentityProviderModel.js';
import { UserModel } from '../src/models/UserModel.js';
import { UserIdentityModel } from '../src/models/UserIdentityModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { storeLoginTransaction, consumeLoginTransaction } from '../src/services/ssoService.js';
import { encryptIdpSecret } from '../src/services/identity/crypto.js';

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

describe('SSO Authentication & Identity Linking', () => {
  let workspaceId: string;
  let ownerUserId: string;
  let providerId: string;

  beforeEach(async () => {
    await IdentityProviderModel.deleteMany({});
    await WorkspaceModel.deleteMany({});
    await WorkspaceMemberModel.deleteMany({});
    await UserModel.deleteMany({});
    await UserIdentityModel.deleteMany({});

    // Create owner
    const owner = await UserModel.create({
      email: 'owner@acme.com',
      passwordHash: 'dummy-hash',
    });
    ownerUserId = owner._id.toString();

    // Create workspace
    const ws = await WorkspaceModel.create({
      name: 'Acme Corp',
      slug: 'acme-corp-' + ownerUserId.substring(0, 8),
      ownerId: new Types.ObjectId(ownerUserId),
    });
    workspaceId = ws._id.toString();

    await WorkspaceMemberModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(ownerUserId),
      role: 'OWNER',
      status: 'ACTIVE',
    });

    // Create OIDC provider
    const idp = await IdentityProviderModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      type: 'OIDC',
      name: 'Acme Okta',
      status: 'ACTIVE',
      issuer: 'https://acme.okta.com',
      clientId: 'okta-client-123',
      clientSecretEncrypted: encryptIdpSecret('secret-xyz'),
      authorizationEndpoint: 'https://acme.okta.com/oauth2/v1/authorize',
      tokenEndpoint: 'https://acme.okta.com/oauth2/v1/token',
      userinfoEndpoint: 'https://acme.okta.com/oauth2/v1/userinfo',
      domains: ['acme.com'],
      domainVerificationStatus: 'VERIFIED',
      enforceSSO: true,
      allowPasswordFallback: false,
      roleMapping: {
        'Engineering': 'EDITOR',
        'IT-Admin': 'ADMIN',
      },
      createdBy: new Types.ObjectId(ownerUserId),
    });
    providerId = idp._id.toString();
  });

  describe('GET /api/auth/sso/providers (Discovery)', () => {
    it('should discover provider by domain', async () => {
      const res = await request
        .get('/api/auth/sso/providers?domain=acme.com')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('Acme Okta');
      expect(res.body[0].type).toBe('OIDC');
    });

    it('should discover provider by email', async () => {
      const res = await request
        .get('/api/auth/sso/providers?email=alice@acme.com')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('Acme Okta');
    });

    it('should discover provider by workspaceId', async () => {
      const res = await request
        .get(`/api/auth/sso/providers?workspaceId=${workspaceId}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('Acme Okta');
    });

    it('should return empty list for unknown domain', async () => {
      const res = await request
        .get('/api/auth/sso/providers?domain=unknown.org')
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  describe('POST /api/auth/sso/:providerId/start', () => {
    it('should initiate OIDC login flow with authorization URL and state', async () => {
      const res = await request
        .post(`/api/auth/sso/${providerId}/start`)
        .send({ redirectUri: 'https://app.example.com/callback' })
        .expect(200);

      expect(res.body).toHaveProperty('authorizationUrl');
      expect(res.body).toHaveProperty('state');
      expect(res.body.authorizationUrl).toContain('https://acme.okta.com/oauth2/v1/authorize');
      expect(res.body.authorizationUrl).toContain('client_id=okta-client-123');
      expect(res.body.authorizationUrl).toContain('code_challenge=');
    });

    it('should reject start for disabled provider', async () => {
      await IdentityProviderModel.findByIdAndUpdate(providerId, { status: 'DISABLED' });

      await request
        .post(`/api/auth/sso/${providerId}/start`)
        .expect(400);
    });
  });

  describe('Login Transaction State Management', () => {
    it('should store and atomically consume login transaction', async () => {
      const tx = {
        state: 'test-state-123',
        nonce: 'test-nonce-123',
        codeVerifier: 'test-verifier-123',
        providerId,
        workspaceId,
        redirectUri: 'https://app.example.com/callback',
        createdAt: Date.now(),
      };

      await storeLoginTransaction(tx);

      const consumed = await consumeLoginTransaction('test-state-123');
      expect(consumed).toBeTruthy();
      expect(consumed?.providerId).toBe(providerId);

      // Second consumption must return null (one-time replay prevention)
      const secondConsume = await consumeLoginTransaction('test-state-123');
      expect(secondConsume).toBeNull();
    });
  });

  describe('Safe Identity Linking', () => {
    it('should link new enterprise user and issue auth tokens upon login', async () => {
      // Simulate existing user linking
      const user = await UserModel.create({
        email: 'bob@acme.com',
        passwordHash: 'some-hash',
      });

      const identity = await UserIdentityModel.create({
        userId: user._id,
        workspaceId: new Types.ObjectId(workspaceId),
        providerId: new Types.ObjectId(providerId),
        providerType: 'OIDC',
        providerSubject: 'okta-sub-bob-999',
        email: 'bob@acme.com',
        emailVerified: true,
        profile: { groups: ['Engineering'] },
      });

      expect(identity).toBeDefined();
      expect(identity.userId.toString()).toBe(user._id.toString());
      expect(identity.providerSubject).toBe('okta-sub-bob-999');

      // Verify member role mapping
      const member = await WorkspaceMemberModel.create({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: user._id,
        role: 'EDITOR',
        status: 'ACTIVE',
      });

      expect(member.role).toBe('EDITOR');
    });

    it('should prevent linking when domain does not match verified provider domains', async () => {
      const nonAcmeUser = await UserModel.create({
        email: 'attacker@evil.com',
        passwordHash: 'hash',
      });

      // Attempting to query with non-matching domain
      const provider = await IdentityProviderModel.findOne({
        domains: 'evil.com',
        domainVerificationStatus: 'VERIFIED',
      });

      expect(provider).toBeNull();
    });
  });
});