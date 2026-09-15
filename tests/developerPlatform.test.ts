import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { hashPassword } from '../src/auth/password.service.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';
import { WEBHOOK_EVENTS } from '../src/models/WebhookModel.js';
import { PERMISSIONS } from '../src/auth/permissions.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;
let accessToken: string;
let workspaceId: string;
let userId: string;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-developer-platform-tests',
  accessTtl: '15m',
  refreshTtl: '7d',
};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());

  const app = createApp({
    auth: authConfig,
    docs: true,
  });
  request = supertest(app);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  await UserModel.deleteMany({});
  await WorkspaceModel.deleteMany({});
  await WorkspaceMemberModel.deleteMany({});
  await AuditLogModel.deleteMany({});

  // Create test user, workspace, and token
  const hashedPassword = await hashPassword('testPassword123!');
  const user = await UserModel.create({
    email: 'developer@example.com',
    passwordHash: hashedPassword,
  });
  userId = user._id.toString();

  const workspace = await WorkspaceModel.create({
    name: 'Developer Workspace',
    slug: 'developer-workspace',
    ownerId: user._id,
    status: 'ACTIVE',
  });
  workspaceId = workspace._id.toString();

  await WorkspaceMemberModel.create({
    workspaceId: workspace._id,
    userId: user._id,
    role: 'OWNER',
    status: 'ACTIVE',
  });

  const authConfig: AuthConfig = {
    jwtSecret: 'test-secret-key-for-developer-platform-tests',
    accessTtl: '15m',
    refreshTtl: '7d',
  };
  accessToken = signAccessToken(authConfig, {
    userId: user._id.toString(),
    email: user.email,
  });
});

describe('Developer Platform API', () => {
  describe('GET /api/v1/developer/info', () => {
    it('returns developer platform information', async () => {
      const response = await request
        .get('/api/v1/developer/info')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      expect(response.body).toHaveProperty('apiVersion');
      expect(response.body.apiVersion).toBe('1.0.0');
      expect(response.body).toHaveProperty('supportedEvents');
      expect(response.body.supportedEvents).toEqual(WEBHOOK_EVENTS);
      expect(response.body).toHaveProperty('permissions');
      expect(response.body.permissions).toEqual(PERMISSIONS);
      expect(response.body).toHaveProperty('rateLimits');
      expect(response.body.rateLimits).toHaveProperty('default');
      expect(response.body.rateLimits.default).toEqual({
        requestsPerMinute: 1000,
        executionsPerHour: 5000,
      });
      expect(response.body.rateLimits.configurable).toBe(true);
      expect(response.body).toHaveProperty('webhookEvents');
      expect(response.body.webhookEvents).toBeInstanceOf(Array);
      expect(response.body.webhookEvents[0]).toHaveProperty('event');
      expect(response.body.webhookEvents[0]).toHaveProperty('description');
      expect(response.body).toHaveProperty('authentication');
      expect(response.body.authentication.type).toBe('API Key');
      expect(response.body.authentication.header).toBe('Authorization');
      expect(response.body.authentication.format).toBe('Bearer {apiKey}');
      expect(response.body.authentication.keyPrefix).toBe('wke_');
      expect(response.body).toHaveProperty('sdks');
      expect(response.body.sdks).toBeInstanceOf(Array);
      expect(response.body.sdks.length).toBeGreaterThanOrEqual(2);
      expect(response.body).toHaveProperty('endpoints');
    });

    it('creates audit log for developer docs view', async () => {
      await request
        .get('/api/v1/developer/info')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      const auditLog = await AuditLogModel.findOne({
        action: 'DEVELOPER_DOCS_VIEWED',
        resource: 'developer_docs',
      });

      expect(auditLog).toBeTruthy();
      expect(auditLog?.userId?.toString()).toBe(userId);
      expect(auditLog?.workspaceId?.toString()).toBe(workspaceId);
    });

    it('requires authentication', async () => {
      const response = await request
        .get('/api/v1/developer/info')
        .set('x-workspace-id', workspaceId)
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('GET /api/v1/developer/examples', () => {
    it('returns all integration examples', async () => {
      const response = await request
        .get('/api/v1/developer/examples')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      expect(response.body).toHaveProperty('examples');
      expect(response.body.examples).toBeInstanceOf(Array);
      expect(response.body.examples.length).toBeGreaterThan(0);
      expect(response.body).toHaveProperty('languages');
      expect(response.body.languages).toEqual(['javascript', 'python', 'bash']);
      expect(response.body).toHaveProperty('categories');
      expect(response.body.categories).toEqual(['trigger', 'webhook', 'error-handling']);

      // Check example structure
      const example = response.body.examples[0];
      expect(example).toHaveProperty('id');
      expect(example).toHaveProperty('title');
      expect(example).toHaveProperty('language');
      expect(example).toHaveProperty('description');
      expect(example).toHaveProperty('code');
    });

    it('filters examples by language', async () => {
      const response = await request
        .get('/api/v1/developer/examples?language=javascript')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      expect(response.body.examples).toBeInstanceOf(Array);
      response.body.examples.forEach((example: any) => {
        expect(example.language).toBe('javascript');
      });
    });

    it('filters examples by python language', async () => {
      const response = await request
        .get('/api/v1/developer/examples?language=python')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      expect(response.body.examples).toBeInstanceOf(Array);
      response.body.examples.forEach((example: any) => {
        expect(example.language).toBe('python');
      });
    });

    it('returns empty array for unknown language', async () => {
      const response = await request
        .get('/api/v1/developer/examples?language=ruby')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      expect(response.body.examples).toEqual([]);
    });

    it('creates audit log for examples view', async () => {
      await request
        .get('/api/v1/developer/examples')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      const auditLog = await AuditLogModel.findOne({
        action: 'DEVELOPER_DOCS_VIEWED',
        resource: 'developer_examples',
      });

      expect(auditLog).toBeTruthy();
      expect(auditLog?.userId?.toString()).toBe(userId);
      expect(auditLog?.workspaceId?.toString()).toBe(workspaceId);
    });

    it('requires authentication', async () => {
      const response = await request
        .get('/api/v1/developer/examples')
        .set('x-workspace-id', workspaceId)
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('includes trigger examples', async () => {
      const response = await request
        .get('/api/v1/developer/examples')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      const triggerExamples = response.body.examples.filter(
        (ex: any) => ex.id.includes('trigger')
      );
      expect(triggerExamples.length).toBeGreaterThan(0);
    });

    it('includes webhook verification examples', async () => {
      const response = await request
        .get('/api/v1/developer/examples')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      const webhookExamples = response.body.examples.filter(
        (ex: any) => ex.id.includes('webhook') || ex.title.toLowerCase().includes('webhook')
      );
      expect(webhookExamples.length).toBeGreaterThan(0);
    });

    it('includes error handling examples', async () => {
      const response = await request
        .get('/api/v1/developer/examples')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      const errorExamples = response.body.examples.filter(
        (ex: any) => ex.id.includes('error')
      );
      expect(errorExamples.length).toBeGreaterThan(0);
    });
  });

  describe('OpenAPI Documentation Enhancement', () => {
    it('includes developer endpoints in OpenAPI document', async () => {
      const response = await request
        .get('/api/openapi.json')
        .expect(200);

      expect(response.body.paths).toHaveProperty('/api/v1/developer/info');
      expect(response.body.paths).toHaveProperty('/api/v1/developer/examples');
      expect(response.body.tags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'Developer',
            description: expect.any(String),
          }),
        ])
      );
    });

    it('documents developer info endpoint correctly', async () => {
      const response = await request
        .get('/api/openapi.json')
        .expect(200);

      const infoPath = response.body.paths['/api/v1/developer/info'];
      expect(infoPath).toBeDefined();
      expect(infoPath.get).toBeDefined();
      expect(infoPath.get.tags).toContain('Developer');
      expect(infoPath.get.summary).toContain('developer platform information');
    });

    it('documents examples endpoint correctly', async () => {
      const response = await request
        .get('/api/openapi.json')
        .expect(200);

      const examplesPath = response.body.paths['/api/v1/developer/examples'];
      expect(examplesPath).toBeDefined();
      expect(examplesPath.get).toBeDefined();
      expect(examplesPath.get.tags).toContain('Developer');
      expect(examplesPath.get.summary).toContain('integration examples');
    });
  });

  describe('SDK Authentication Patterns', () => {
    it('developer info response includes authentication details', async () => {
      const response = await request
        .get('/api/v1/developer/info')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      expect(response.body.authentication).toEqual({
        type: 'API Key',
        header: 'Authorization',
        format: 'Bearer {apiKey}',
        keyPrefix: 'wke_',
      });
    });

    it('developer info response includes SDK information', async () => {
      const response = await request
        .get('/api/v1/developer/info')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      const jsSdk = response.body.sdks.find((sdk: any) => sdk.name.includes('JavaScript'));
      expect(jsSdk).toBeDefined();
      expect(jsSdk.package).toBe('@workflow-engine/sdk');

      const pythonSdk = response.body.sdks.find((sdk: any) => sdk.name.includes('Python'));
      expect(pythonSdk).toBeDefined();
      expect(pythonSdk.package).toBe('workflow-engine');
    });
  });

  describe('Webhook Event Documentation', () => {
    it('returns all supported webhook events with descriptions', async () => {
      const response = await request
        .get('/api/v1/developer/info')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      expect(response.body.webhookEvents.length).toBe(WEBHOOK_EVENTS.length);

      const startedEvent = response.body.webhookEvents.find(
        (we: any) => we.event === 'WORKFLOW_EXECUTION_STARTED'
      );
      expect(startedEvent).toBeDefined();
      expect(startedEvent.description).toBeTruthy();
      expect(startedEvent.description).toContain('begins processing');
    });
  });
});
