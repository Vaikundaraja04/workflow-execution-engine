import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowVersionModel } from '../src/models/WorkflowVersionModel.js';
import { UserModel } from '../src/models/UserModel.js';
import { hashPassword } from '../src/auth/password.service.js';
import { signAccessToken } from '../src/auth/jwt.service.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};
let accessToken: string;
let testUserId: string;

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

function validDefinition(message = 'ready') {
  return {
    nodes: [
      { id: 'trigger', type: 'webhook', config: {} },
      { id: 'log', type: 'log', config: { message } },
    ],
    edges: [{ source: 'trigger', target: 'log' }],
  };
}

async function createValidWorkflow(name: string): Promise<string> {
  const response = await request.post('/api/workflows').send({
    name,
    definition: validDefinition(),
  });
  expect(response.status).toBe(201);
  return response.body._id;
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
  const user = await UserModel.create({
    email: 'workflow-api-tests@example.com',
    passwordHash: await hashPassword('test-password-123'),
  });
  testUserId = user._id.toString();
  accessToken = signAccessToken(authConfig, { userId: testUserId, email: user.email });

  const app = createApp({ auth: authConfig });
  const authedApp = express();
  authedApp.use((req, _res, next) => {
    if (!req.headers.authorization) req.headers.authorization = `Bearer ${accessToken}`;
    next();
  });
  authedApp.use(app);
  request = supertest(authedApp);
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

beforeEach(async () => {
  await WorkflowModel.deleteMany({});
  await WorkflowVersionModel.deleteMany({});
});

describe('Phase 2B API', () => {
  it('1. health endpoint works', async () => {
    const res = await request.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('2. workflow creation works', async () => {
    const res = await request.post('/api/workflows').send({
      name: 'Test WF',
      definition: { nodes: [{ id: "trigger", type: "webhook", config: {} }], edges: [] },
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test WF');
  });

  it('3. invalid request body is rejected', async () => {
    const res = await request.post('/api/workflows').send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('4. whitespace-only name is rejected', async () => {
    const res = await request.post('/api/workflows').send({
      name: '   ',
      definition: { nodes: [{ id: "trigger", type: "webhook", config: {} }], edges: [] },
    });
    expect(res.status).toBe(400);
  });

  it('5. workflow can be retrieved', async () => {
    const create = await request.post('/api/workflows').send({
      name: 'Get Test',
      definition: { nodes: [{ id: 'w', type: 'webhook', config: {} }], edges: [] },
    });
    const id = create.body._id;
    const get = await request.get(`/api/workflows/${id}`);
    expect(get.status).toBe(200);
    expect(get.body.name).toBe('Get Test');
    expect(get.body.draftDefinition.nodes[0].config).toEqual({});
  });

  it('6. invalid ObjectId returns 400', async () => {
    const res = await request.get('/api/workflows/invalidid');
    expect(res.status).toBe(400);
  });

  it('7. missing workflow returns 404', async () => {
    const res = await request.get('/api/workflows/507f1f77bcf86cd799439011');
    expect(res.status).toBe(404);
  });

  it('8. draft can be updated', async () => {
    const create = await request.post('/api/workflows').send({
      name: 'Update Test',
      definition: { nodes: [{ id: "trigger", type: "webhook", config: {} }], edges: [] },
    });
    const id = create.body._id;
    const update = await request.put(`/api/workflows/${id}/draft`).send({ name: 'Updated Name' });
    expect(update.status).toBe(200);
    expect(update.body.name).toBe('Updated Name');
  });

  it('9. graph-invalid draft can be saved', async () => {
    const create = await request.post('/api/workflows').send({
      name: 'Invalid Graph',
      definition: { nodes: [{ id: 'w', type: 'webhook', config: {} }, { id: 'l', type: 'log', config: { message: 'x' } }], edges: [] },
    });
    expect(create.status).toBe(201);
  });

  it('10. validate endpoint reports graph errors', async () => {
    const create = await request.post('/api/workflows').send({
      name: 'Validate Test',
      definition: { nodes: [{ id: 'w', type: 'webhook', config: {} }, { id: 'l', type: 'log', config: { message: 'x' } }], edges: [] },
    });
    const id = create.body._id;
    const val = await request.post(`/api/workflows/${id}/validate`);
    expect(val.body.valid).toBe(false);
  });

  it('11. invalid graph cannot be published', async () => {
    const create = await request.post('/api/workflows').send({
      name: 'Bad Publish',
      definition: { nodes: [{ id: 'w', type: 'webhook', config: {} }, { id: 'l', type: 'log', config: { message: 'x' } }], edges: [] },
    });
    const id = create.body._id;
    const pub = await request.post(`/api/workflows/${id}/publish`);
    expect(pub.status).toBe(422);
    expect(pub.body.error.code).toBe('INVALID_WORKFLOW_GRAPH');
  });

  it('12. first publication creates V1', async () => {
    const create = await request.post('/api/workflows').send({
      name: 'V1 Test',
      definition: { nodes: [{ id: 'w', type: 'webhook', config: {} }, { id: 'l', type: 'log', config: { message: 'hi' } }], edges: [{ source: 'w', target: 'l' }] },
    });
    const id = create.body._id;
    const pub = await request.post(`/api/workflows/${id}/publish`);
    expect(pub.status).toBe(201);
    expect(pub.body.versionNumber).toBe(1);
  });

  it('13. editing the draft after V1 does not alter V1', async () => {
    const create = await request.post('/api/workflows').send({
      name: 'Edit After Publish',
      definition: { nodes: [{ id: 'w', type: 'webhook', config: {} }, { id: 'l', type: 'log', config: { message: 'v1' } }], edges: [{ source: 'w', target: 'l' }] },
    });
    const id = create.body._id;
    await request.post(`/api/workflows/${id}/publish`);
    await request.put(`/api/workflows/${id}/draft`).send({ definition: { nodes: [{ id: 'w', type: 'webhook', config: {} }, { id: 'l2', type: 'log', config: { message: 'v2' } }], edges: [{ source: 'w', target: 'l2' }] } });
    const versions = await request.get(`/api/workflows/${id}/versions`);
    expect(versions.body[0].definition.nodes[1].config.message).toBe('v1');
  });

  it('14. second publication creates V2', async () => {
    const create = await request.post('/api/workflows').send({
      name: 'V2 Test',
      definition: { nodes: [{ id: 'w', type: 'webhook', config: {} }, { id: 'l', type: 'log', config: { message: 'v1' } }], edges: [{ source: 'w', target: 'l' }] },
    });
    const id = create.body._id;
    await request.post(`/api/workflows/${id}/publish`);
    await request.put(`/api/workflows/${id}/draft`).send({ definition: { nodes: [{ id: 'w', type: 'webhook', config: {} }, { id: 'l', type: 'log', config: { message: 'v2' } }], edges: [{ source: 'w', target: 'l' }] } });
    const pub2 = await request.post(`/api/workflows/${id}/publish`);
    expect(pub2.body.versionNumber).toBe(2);
  });

  it('15. versions are returned in ascending order', async () => {
    const create = await request.post('/api/workflows').send({
      name: 'Order Test',
      definition: { nodes: [{ id: 'w', type: 'webhook', config: {} }, { id: 'l', type: 'log', config: { message: 'x' } }], edges: [{ source: 'w', target: 'l' }] },
    });
    const id = create.body._id;
    await request.post(`/api/workflows/${id}/publish`);
    await request.put(`/api/workflows/${id}/draft`).send({ name: 'Order Test V2' });
    await request.post(`/api/workflows/${id}/publish`);
    const versions = await request.get(`/api/workflows/${id}/versions`);
    expect(versions.status).toBe(200);
    expect(versions.body.map((version: { versionNumber: number }) => version.versionNumber)).toEqual([1, 2]);
  });

  it('16. unknown routes return JSON error', async () => {
    const res = await request.get('/api/unknown');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('17. safe error responses do not leak internals', async () => {
    const res = await request.get('/api/workflows/123');
    expect(res.body.error.code).toBe('INVALID_WORKFLOW_ID');
    expect(res.body.error.message).not.toContain('mongoose');
  });

  it('18. public execution exports still available', async () => {
    const { executeWorkflow } = await import('../src/index.js');
    expect(typeof executeWorkflow).toBe('function');
  });

  it('19. missing request body is rejected', async () => {
    const res = await request.post('/api/workflows');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('20. missing workflow definition is rejected', async () => {
    const res = await request.post('/api/workflows').send({ name: 'Missing definition' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('21. names longer than 120 characters are rejected', async () => {
    const res = await request.post('/api/workflows').send({
      name: 'x'.repeat(121),
      definition: validDefinition(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('22. unknown create fields are rejected', async () => {
    const res = await request.post('/api/workflows').send({
      name: 'Strict create',
      definition: validDefinition(),
      unexpected: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('23. malformed JSON returns a safe JSON error', async () => {
    const res = await request
      .post('/api/workflows')
      .set('Content-Type', 'application/json')
      .send('{"name":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'INVALID_JSON',
        message: 'Request body contains invalid JSON',
      },
    });
  });

  it('24. an empty draft update is rejected', async () => {
    const id = await createValidWorkflow('Empty update');
    const res = await request.put(`/api/workflows/${id}/draft`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('25. unknown draft update fields are rejected', async () => {
    const id = await createValidWorkflow('Strict update');
    const res = await request.put(`/api/workflows/${id}/draft`).send({ unexpected: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('26. an invalid ID is rejected by draft update', async () => {
    const res = await request
      .put('/api/workflows/not-an-object-id/draft')
      .send({ name: 'Updated' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_WORKFLOW_ID');
  });

  it('27. an invalid ID is rejected by validation', async () => {
    const res = await request.post('/api/workflows/not-an-object-id/validate');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_WORKFLOW_ID');
  });

  it('28. an invalid ID is rejected by publishing', async () => {
    const res = await request.post('/api/workflows/not-an-object-id/publish');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_WORKFLOW_ID');
  });

  it('29. an invalid ID is rejected by version listing', async () => {
    const res = await request.get('/api/workflows/not-an-object-id/versions');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_WORKFLOW_ID');
  });

  it('30. validating a missing workflow returns 404', async () => {
    const res = await request.post('/api/workflows/507f191e810c19729de860ea/validate');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('31. publishing a missing workflow returns 404', async () => {
    const res = await request.post('/api/workflows/507f191e810c19729de860ea/publish');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('32. listing versions for a missing workflow returns 404', async () => {
    const res = await request.get('/api/workflows/507f191e810c19729de860ea/versions');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('33. validation reports schema errors before graph errors', async () => {
    const inserted = await WorkflowModel.collection.insertOne({
      name: 'Legacy invalid draft',
      draftDefinition: { nodes: 'not-an-array', edges: [] },
      ownerId: new Types.ObjectId(testUserId),
      status: 'DRAFT',
      latestVersionNumber: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request.post(`/api/workflows/${inserted.insertedId.toString()}/validate`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.schemaErrors.length).toBeGreaterThan(0);
    expect(res.body.graphErrors).toEqual([]);
  });

  it('34. publishing a schema-invalid stored draft returns the schema error', async () => {
    const inserted = await WorkflowModel.collection.insertOne({
      name: 'Legacy invalid publish',
      draftDefinition: { nodes: 'not-an-array', edges: [] },
      ownerId: new Types.ObjectId(testUserId),
      status: 'DRAFT',
      latestVersionNumber: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const workflowId = inserted.insertedId.toString();
    const res = await request.post(`/api/workflows/${workflowId}/publish`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_WORKFLOW_SCHEMA');
    expect(await WorkflowVersionModel.countDocuments({ workflowId })).toBe(0);
  });

  it('35. editing a published workflow returns it to draft status', async () => {
    const id = await createValidWorkflow('Published workflow');
    const publish = await request.post(`/api/workflows/${id}/publish`);
    expect(publish.status).toBe(201);

    const update = await request
      .put(`/api/workflows/${id}/draft`)
      .send({ name: 'Published workflow edited' });
    expect(update.status).toBe(200);
    expect(update.body.status).toBe('DRAFT');
    expect(update.body.latestVersionNumber).toBe(1);
  });
});
