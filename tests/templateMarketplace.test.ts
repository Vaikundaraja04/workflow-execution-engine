import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { WorkflowTemplateModel } from '../src/models/WorkflowTemplateModel.js';
import { TemplateVersionModel } from '../src/models/TemplateVersionModel.js';
import { PublisherProfileModel } from '../src/models/PublisherProfileModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { hashPassword } from '../src/auth/password.service.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';
import { WorkflowPackageService } from '../src/services/workflowPackageService.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

let ownerAccessToken: string;
let ownerUserId: string;
let viewerAccessToken: string;
let viewerUserId: string;
let workspaceId: string;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-template-marketplace-tests',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const sampleWorkflow: WorkflowDefinition = {
  nodes: [
    { id: 'trigger', type: 'webhook', config: {} },
    { id: 'logger', type: 'log', config: { message: 'Order processed successfully' } },
  ],
  edges: [{ source: 'trigger', target: 'logger' }],
};

const updatedWorkflow: WorkflowDefinition = {
  nodes: [
    { id: 'trigger', type: 'webhook', config: {} },
    { id: 'condition', type: 'condition', config: { field: 'amount', operator: 'greaterThan', value: 100 } },
    { id: 'logger', type: 'log', config: { message: 'High value order' } },
  ],
  edges: [
    { source: 'trigger', target: 'condition' },
    { source: 'condition', target: 'logger' },
  ],
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
  await WorkflowTemplateModel.deleteMany({});
  await TemplateVersionModel.deleteMany({});
  await PublisherProfileModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await AuditLogModel.deleteMany({});

  // 1. Create owner user and workspace
  const hashedPassword = await hashPassword('TestPassword123!');
  const owner = await UserModel.create({
    email: 'owner@example.com',
    passwordHash: hashedPassword,
  });
  ownerUserId = owner._id.toString();

  const workspace = await WorkspaceModel.create({
    name: 'Automation Workspace',
    slug: 'automation-workspace',
    ownerId: owner._id,
    status: 'ACTIVE',
  });
  workspaceId = workspace._id.toString();

  await WorkspaceMemberModel.create({
    workspaceId: workspace._id,
    userId: owner._id,
    role: 'OWNER',
    status: 'ACTIVE',
  });

  ownerAccessToken = signAccessToken(authConfig, {
    userId: owner._id.toString(),
    email: owner.email,
  });

  // 2. Create viewer user in the same workspace
  const viewer = await UserModel.create({
    email: 'viewer@example.com',
    passwordHash: hashedPassword,
  });
  viewerUserId = viewer._id.toString();

  await WorkspaceMemberModel.create({
    workspaceId: workspace._id,
    userId: viewer._id,
    role: 'VIEWER',
    status: 'ACTIVE',
  });

  viewerAccessToken = signAccessToken(authConfig, {
    userId: viewer._id.toString(),
    email: viewer.email,
  });
});

describe('Phase 6C: Workflow Templates & Marketplace Ecosystem', () => {
  describe('1. Template Lifecycle & CRUD', () => {
    it('creates a workspace-scoped template with initial version 1 and audit logging', async () => {
      const res = await request
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          name: 'Order Processing Pipeline',
          description: 'Standard ecommerce order flow',
          category: 'Automation',
          visibility: 'WORKSPACE',
          tags: ['ecommerce', 'orders'],
          metadata: {
            icon: 'shopping-cart',
            documentation: 'Processes inbound webhook orders',
            requirements: ['webhook'],
          },
          workflowDefinition: sampleWorkflow,
        })
        .expect(201);

      expect(res.body).toHaveProperty('_id');
      expect(res.body.name).toBe('Order Processing Pipeline');
      expect(res.body.category).toBe('Automation');
      expect(res.body.visibility).toBe('WORKSPACE');
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.versionCount).toBe(1);

      // Verify initial version created
      const versions = await TemplateVersionModel.find({ templateId: res.body._id });
      expect(versions).toHaveLength(1);
      expect(versions[0]?.versionNumber).toBe(1);
      expect(versions[0]?.changeSummary).toBe('Initial version');
      expect(versions[0]?.definitionHash).toBeTruthy();

      // Verify audit log
      const audit = await AuditLogModel.findOne({
        action: 'TEMPLATE_CREATED',
        resourceId: res.body._id,
      });
      expect(audit).toBeTruthy();
      expect(audit?.userId?.toString()).toBe(ownerUserId);
    });

    it('rejects template creation with invalid workflow graph (cycles)', async () => {
      const cyclicWorkflow = {
        nodes: [
          { id: 'nodeA', type: 'log', config: { message: 'A' } },
          { id: 'nodeB', type: 'log', config: { message: 'B' } },
        ],
        edges: [
          { source: 'nodeA', target: 'nodeB' },
          { source: 'nodeB', target: 'nodeA' },
        ],
      };

      const res = await request
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          name: 'Cyclic Workflow',
          category: 'Automation',
          visibility: 'PRIVATE',
          workflowDefinition: cyclicWorkflow,
        })
        .expect(400);

      expect(res.body.error.message).toMatch(/graph/i);
    });

    it('updates template metadata and bumps version when definition changes', async () => {
      const createRes = await request
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          name: 'Original Template',
          category: 'Integration',
          visibility: 'WORKSPACE',
          workflowDefinition: sampleWorkflow,
        })
        .expect(201);

      const templateId = createRes.body._id;

      // Update definition
      const updateRes = await request
        .patch(`/api/v1/templates/${templateId}`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          name: 'Updated Order Flow',
          workflowDefinition: updatedWorkflow,
          changeSummary: 'Added conditional routing node',
        })
        .expect(200);

      expect(updateRes.body.name).toBe('Updated Order Flow');
      expect(updateRes.body.versionCount).toBe(2);

      // Verify 2 versions exist
      const versions = await TemplateVersionModel.find({ templateId }).sort({ versionNumber: 1 });
      expect(versions).toHaveLength(2);
      expect(versions[1]?.versionNumber).toBe(2);
      expect(versions[1]?.changeSummary).toBe('Added conditional routing node');
    });

    it('archives a template', async () => {
      const createRes = await request
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          name: 'To Archive',
          category: 'Monitoring',
          visibility: 'WORKSPACE',
          workflowDefinition: sampleWorkflow,
        })
        .expect(201);

      const templateId = createRes.body._id;

      const archiveRes = await request
        .post(`/api/v1/templates/${templateId}/archive`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      expect(archiveRes.body.status).toBe('ARCHIVED');
    });
  });

  describe('2. Permissions & RBAC', () => {
    it('prevents VIEWER from creating workspace templates', async () => {
      const res = await request
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${viewerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          name: 'Unauthorized Template',
          category: 'Automation',
          visibility: 'WORKSPACE',
          workflowDefinition: sampleWorkflow,
        })
        .expect(403);

      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('allows VIEWER to view accessible templates in workspace', async () => {
      const createRes = await request
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          name: 'Shared Workspace Template',
          category: 'Automation',
          visibility: 'WORKSPACE',
          workflowDefinition: sampleWorkflow,
        })
        .expect(201);

      const templateId = createRes.body._id;

      const getRes = await request
        .get(`/api/v1/templates/${templateId}`)
        .set('Authorization', `Bearer ${viewerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      expect(getRes.body._id).toBe(templateId);
    });
  });

  describe('3. Version Rollback & Diff Comparison', () => {
    it('compares two template versions and calculates node diffs', async () => {
      const createRes = await request
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          name: 'Versioned Flow',
          category: 'Integration',
          visibility: 'WORKSPACE',
          workflowDefinition: sampleWorkflow,
        })
        .expect(201);

      const templateId = createRes.body._id;

      // Update to create version 2
      await request
        .patch(`/api/v1/templates/${templateId}`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          workflowDefinition: updatedWorkflow,
          changeSummary: 'Added condition',
        })
        .expect(200);

      // Compare v1 and v2
      const compareRes = await request
        .get(`/api/v1/templates/${templateId}/compare?v1=1&v2=2`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      expect(compareRes.body.v1.versionNumber).toBe(1);
      expect(compareRes.body.v2.versionNumber).toBe(2);
      expect(compareRes.body.nodeChanges.added).toContain('condition');
    });

    it('rolls back to an earlier version creating a new version snapshot', async () => {
      const createRes = await request
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          name: 'Rollback Flow',
          category: 'Integration',
          visibility: 'WORKSPACE',
          workflowDefinition: sampleWorkflow,
        })
        .expect(201);

      const templateId = createRes.body._id;

      // v2
      await request
        .patch(`/api/v1/templates/${templateId}`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          workflowDefinition: updatedWorkflow,
          changeSummary: 'Update to v2',
        })
        .expect(200);

      // Rollback to v1 (creates v3 with v1 definition)
      const rollbackRes = await request
        .post(`/api/v1/templates/${templateId}/rollback`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({ versionNumber: 1 })
        .expect(200);

      expect(rollbackRes.body.versionCount).toBe(3);

      const versions = await TemplateVersionModel.find({ templateId }).sort({ versionNumber: 1 });
      expect(versions).toHaveLength(3);
      expect(versions[2]?.changeSummary).toContain('Rollback to version 1');
      expect(versions[2]?.workflowDefinition.nodes).toHaveLength(sampleWorkflow.nodes.length);
    });
  });

  describe('4. Template Installation into Workspace', () => {
    it('installs a published template as a runnable workflow in target workspace', async () => {
      const createRes = await request
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          name: 'Lead Generation Template',
          category: 'AI Workflow',
          visibility: 'WORKSPACE',
          workflowDefinition: sampleWorkflow,
        })
        .expect(201);

      const templateId = createRes.body._id;

      // Publish template
      await request
        .post(`/api/v1/templates/${templateId}/publish`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      // Install template
      const installRes = await request
        .post(`/api/v1/templates/${templateId}/install`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({
          workspaceId,
          workflowName: 'My Live Lead Pipeline',
        })
        .expect(201);

      expect(installRes.body).toHaveProperty('workflow');
      expect(installRes.body.workflow.name).toBe('My Live Lead Pipeline');
      expect(installRes.body.workflow.workspaceId).toBe(workspaceId);

      // Check workflow in DB
      const workflowInDb = await WorkflowModel.findById(installRes.body.workflow._id);
      expect(workflowInDb).toBeTruthy();
      expect(workflowInDb?.draftDefinition.nodes).toHaveLength(2);

      // Check template install statistics incremented
      const updatedTemplate = await WorkflowTemplateModel.findById(templateId);
      expect(updatedTemplate?.statistics.installs).toBe(1);

      // Check audit log
      const audit = await AuditLogModel.findOne({
        action: 'TEMPLATE_INSTALLED',
        resourceId: templateId,
      });
      expect(audit).toBeTruthy();
    });
  });

  describe('5. Import & Export Workflow Packages', () => {
    it('exports a template into a portable package and imports it back safely', async () => {
      const createRes = await request
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          name: 'Exportable Pipeline',
          description: 'A portable workflow automation',
          category: 'Data Processing',
          visibility: 'PUBLIC',
          tags: ['data', 'analytics'],
          workflowDefinition: sampleWorkflow,
        })
        .expect(201);

      const templateId = createRes.body._id;

      // Export template
      const exportRes = await request
        .post(`/api/v1/templates/${templateId}/export`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .expect(200);

      expect(exportRes.body).toHaveProperty('version', '1.0');
      expect(exportRes.body).toHaveProperty('checksum');
      expect(exportRes.body.template.name).toBe('Exportable Pipeline');
      expect(exportRes.body.workflow.nodes).toHaveLength(2);

      // Import package as new template
      const importRes = await request
        .post('/api/v1/templates/import')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          packageData: exportRes.body,
          visibility: 'WORKSPACE',
        })
        .expect(201);

      expect(importRes.body.name).toBe('Exportable Pipeline');
      expect(importRes.body.visibility).toBe('WORKSPACE');
      expect(importRes.body.category).toBe('Data Processing');
    });

    it('rejects packages with prototype pollution attempts', async () => {
      const maliciousPayload = JSON.parse(`{
        "version": "1.0",
        "template": {
          "name": "Malicious Template",
          "category": "Automation",
          "__proto__": { "polluted": true }
        },
        "workflow": {
          "nodes": [{ "id": "trigger", "type": "webhook", "config": {} }],
          "edges": []
        }
      }`);

      expect(() => {
        WorkflowPackageService.validatePackage(maliciousPayload);
      }).toThrow(/Security violation/i);
    });
  });

  describe('6. Template Ratings & Reviews', () => {
    it('allows users to rate a published template and calculates average score', async () => {
      const createRes = await request
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          name: 'Ratable Template',
          category: 'Notifications',
          visibility: 'PUBLIC',
          workflowDefinition: sampleWorkflow,
        })
        .expect(201);

      const templateId = createRes.body._id;

      await request
        .post(`/api/v1/templates/${templateId}/publish`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      // Rate with 5 stars
      const rateRes = await request
        .post(`/api/v1/templates/${templateId}/rate`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({
          rating: 5,
          review: 'Outstanding automation!',
        })
        .expect(200);

      expect(rateRes.body.rating.average).toBe(5);
      expect(rateRes.body.rating.count).toBe(1);

      // Second user rates with 3 stars
      const rateRes2 = await request
        .post(`/api/v1/templates/${templateId}/rate`)
        .set('Authorization', `Bearer ${viewerAccessToken}`)
        .send({
          rating: 3,
          review: 'Works well but needs more docs',
        })
        .expect(200);

      expect(rateRes2.body.rating.average).toBe(4);
      expect(rateRes2.body.rating.count).toBe(2);
    });

    it('rejects rating out of 1-5 range', async () => {
      const createRes = await request
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          name: 'Rate Range Test',
          category: 'Notifications',
          visibility: 'PUBLIC',
          workflowDefinition: sampleWorkflow,
        })
        .expect(201);

      const templateId = createRes.body._id;

      await request
        .post(`/api/v1/templates/${templateId}/rate`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({ rating: 6 })
        .expect(400);
    });
  });

  describe('7. Publisher Profiles & Marketplace', () => {
    it('creates and fetches user publisher profile', async () => {
      const putRes = await request
        .put('/api/v1/templates/publisher/profile')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({
          displayName: 'Acme Cloud Solutions',
          description: 'Official verified workflow integrations for enterprise',
        })
        .expect(200);

      expect(putRes.body.displayName).toBe('Acme Cloud Solutions');
      expect(putRes.body.verified).toBe(false);

      const getRes = await request
        .get('/api/v1/templates/publisher/profile')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .expect(200);

      expect(getRes.body.profile.displayName).toBe('Acme Cloud Solutions');
    });
  });

  describe('8. Search & Discovery', () => {
    it('searches and filters templates by query, category, and tags', async () => {
      // Create template A
      await request
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          name: 'Stripe Payment Sync',
          category: 'Integration',
          visibility: 'PUBLIC',
          tags: ['stripe', 'payments', 'finance'],
          workflowDefinition: sampleWorkflow,
        })
        .expect(201);

      // Create template B
      await request
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .send({
          name: 'Slack Alert Dispatcher',
          category: 'Notifications',
          visibility: 'PUBLIC',
          tags: ['slack', 'alerts'],
          workflowDefinition: sampleWorkflow,
        })
        .expect(201);

      // Search by query
      const searchRes = await request
        .get('/api/v1/templates?q=Stripe')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      expect(searchRes.body.templates).toHaveLength(1);
      expect(searchRes.body.templates[0].name).toBe('Stripe Payment Sync');

      // Filter by category
      const catRes = await request
        .get('/api/v1/templates?category=Notifications')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);

      expect(catRes.body.templates).toHaveLength(1);
      expect(catRes.body.templates[0].name).toBe('Slack Alert Dispatcher');
    });
  });
});
