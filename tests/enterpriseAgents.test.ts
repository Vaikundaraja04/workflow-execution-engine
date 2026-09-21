import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import supertest from 'supertest';
import { createApp } from '../src/api/app.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import { permissionsForRole } from '../src/auth/permissions.js';
import { AIProviderFactory } from '../src/services/ai/AIProviderFactory.js';
import { AIUsageService } from '../src/services/aiUsageService.js';
import { AgentModel } from '../src/models/AgentModel.js';
import { AgentRunModel } from '../src/models/AgentRunModel.js';
import { AgentMemoryModel } from '../src/models/AgentMemoryModel.js';
import { ApprovalRequestModel } from '../src/models/ApprovalRequestModel.js';
import { AgentToolPolicyModel } from '../src/models/AgentToolPolicyModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { AgentToolPolicyService } from '../src/services/agent/agentToolPolicyService.js';
import * as auditService from '../src/services/auditService.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const wsHeader = (wsId: string) => ({ 'X-Workspace-Id': wsId });

describe('Phase 12.2 — Enterprise Autonomous Agent Platform', () => {
  let replSet: MongoMemoryReplSet;
  let request: ReturnType<typeof supertest>;

  let ws1Id: string, ws2Id: string;
  let ownerToken: string, editorToken: string, viewerToken: string;
  let ownerId: string, editorId: string, viewerId: string;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    request = supertest(createApp({ auth: authConfig, authRateLimit: { loginLimit: 1000, refreshLimit: 1000 } }));
  }, 180000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  }, 30000);

  beforeEach(async () => {
    vi.restoreAllMocks();
    AIProviderFactory.resetMockProvider();
    vi.spyOn(AIUsageService, 'recordUsage').mockResolvedValue({} as never);
    vi.spyOn(auditService, 'createAuditLog').mockResolvedValue({} as never);

    await AgentModel.deleteMany({}).exec();
    await AgentRunModel.deleteMany({}).exec();
    await AgentMemoryModel.deleteMany({}).exec();
    await ApprovalRequestModel.deleteMany({}).exec();
    await AgentToolPolicyModel.deleteMany({}).exec();
    await WorkspaceMemberModel.deleteMany({}).exec();
    await WorkspaceModel.deleteMany({}).exec();
    await UserModel.deleteMany({}).exec();

    const policySvc = AgentToolPolicyService.getInstance();
    policySvc.clearWorkspace(ws1Id ?? 'temp');
    policySvc.clearWorkspace(ws2Id ?? 'temp');

    const owner = await UserModel.create({ email: 'agent-owner@test.dev', passwordHash: 'x' });
    const editor = await UserModel.create({ email: 'agent-editor@test.dev', passwordHash: 'x' });
    const viewer = await UserModel.create({ email: 'agent-viewer@test.dev', passwordHash: 'x' });
    ownerId = owner._id.toString();
    editorId = editor._id.toString();
    viewerId = viewer._id.toString();

    const ws1 = await WorkspaceModel.create({
      name: 'Agent Test WS1', slug: `agent-ws1-${new Types.ObjectId().toString()}`, ownerId: owner._id, status: 'ACTIVE',
    });
    const ws2 = await WorkspaceModel.create({
      name: 'Agent Test WS2', slug: `agent-ws2-${new Types.ObjectId().toString()}`, ownerId: owner._id, status: 'ACTIVE',
    });
    ws1Id = ws1._id.toString();
    ws2Id = ws2._id.toString();

    for (const [user, role] of [[owner, 'OWNER'], [editor, 'EDITOR'], [viewer, 'VIEWER']] as const) {
      await WorkspaceMemberModel.create({
        workspaceId: ws1._id, userId: user._id, role, status: 'ACTIVE', permissions: permissionsForRole(role),
      });
    }
    await WorkspaceMemberModel.create({
      workspaceId: ws2._id, userId: owner._id, role: 'OWNER', status: 'ACTIVE', permissions: permissionsForRole('OWNER'),
    });
    policySvc.clearWorkspace(ws1Id);
    policySvc.clearWorkspace(ws2Id);

    ownerToken = signAccessToken(authConfig, { userId: ownerId, email: 'agent-owner@test.dev' });
    editorToken = signAccessToken(authConfig, { userId: editorId, email: 'agent-editor@test.dev' });
        viewerToken = signAccessToken(authConfig, { userId: viewerId, email: 'agent-viewer@test.dev' });
  }, 30000);

  describe('Agent CRUD', () => {
    it('creates an agent with valid input', async () => {
      const res = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Test Agent', systemPrompt: 'You are a test agent.' });
      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Test Agent');
      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.version).toBe(1);
      expect(res.body.data.toolsAllowed).toEqual([]);
    });

    it('rejects creation without name or systemPrompt', async () => {
      const res = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: '', systemPrompt: '' });
      expect(res.status).toBe(400);
    });

    it('lists all agents in a workspace', async () => {
      await request.post('/api/v1/agents').set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Agent A', systemPrompt: 'System A' });
      await request.post('/api/v1/agents').set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Agent B', systemPrompt: 'System B' });
      const res = await request.get('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id));
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
    });

    it('fetches a single agent by ID', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Fetch Test', systemPrompt: 'Test' });
      const res = await request.get(`/api/v1/agents/${created.body.data._id}`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id));
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Fetch Test');
    });

    it('returns 404 for non-existent agent', async () => {
      const res = await request.get(`/api/v1/agents/${new Types.ObjectId().toString()}`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id));
      expect(res.status).toBe(404);
    });

    it('updates an agent and increments version', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Update Me', systemPrompt: 'Old prompt' });
      const res = await request.put(`/api/v1/agents/${created.body.data._id}`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Updated Name', systemPrompt: 'New prompt', status: 'ACTIVE' });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated Name');
      expect(res.body.data.systemPrompt).toBe('New prompt');
      expect(res.body.data.status).toBe('ACTIVE');
      expect(res.body.data.version).toBe(2);
    });

    it('deletes an agent', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Delete Me', systemPrompt: 'Test' });
      const id = created.body.data._id;
      const res = await request.delete(`/api/v1/agents/${id}`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id));
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
      const getRes = await request.get(`/api/v1/agents/${id}`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id));
      expect(getRes.status).toBe(404);
    });

    it('rejects duplicate agent names in the same workspace', async () => {
      await request.post('/api/v1/agents').set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Duplicate', systemPrompt: 'Test' });
      const res = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Duplicate', systemPrompt: 'Test' });
            expect(res.status).toBe(409);
    });
  });

  describe('Workspace Isolation & RBAC', () => {
    it('isolates agents between workspaces', async () => {
      await request.post('/api/v1/agents').set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'WS1 Agent', systemPrompt: 'Test' });
      // List in ws2 → should not see ws1's agent
      const ws2Res = await request.get('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws2Id));
      expect(ws2Res.status).toBe(200);
      expect(ws2Res.body.data.length).toBe(0);
      // Try to GET the ws1 agent from ws2 → 404
      const ws1Res = await request.get('/api/v1/agents').set(auth(ownerToken)).set(wsHeader(ws1Id));
      const ws1AgentId = ws1Res.body.data[0]._id;
      const crossWsGet = await request.get(`/api/v1/agents/${ws1AgentId}`)
        .set(auth(ownerToken)).set(wsHeader(ws2Id));
      expect(crossWsGet.status).toBe(404);
    });

    it('editor can read agents but cannot create in ws1', async () => {
      await request.post('/api/v1/agents').set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'RBAC Test', systemPrompt: 'Test' });
      // Editor can list
      const listRes = await request.get('/api/v1/agents')
        .set(auth(editorToken)).set(wsHeader(ws1Id));
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBe(1);
      // Editor cannot create
      const createRes = await request.post('/api/v1/agents')
        .set(auth(editorToken)).set(wsHeader(ws1Id))
        .send({ name: 'Editor Agent', systemPrompt: 'Test' });
      expect(createRes.status).toBe(403);
    });

    it('viewer cannot access agents (no AGENT_READ)', async () => {
      const res = await request.get('/api/v1/agents')
        .set(auth(viewerToken)).set(wsHeader(ws1Id));
      expect(res.status).toBe(403);
    });

    it('viewer cannot create agents', async () => {
      const res = await request.post('/api/v1/agents')
        .set(auth(viewerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Viewer Agent', systemPrompt: 'Test' });
      expect(res.status).toBe(403);
    });

    it('editor cannot access agents in ws2 (not a member)', async () => {
      const res = await request.get('/api/v1/agents')
        .set(auth(editorToken)).set(wsHeader(ws2Id));
      // Not a member returns 404 (no workspace context) or 403 (forbidden)
      expect([403, 404]).toContain(res.status);
    });
  });

  describe('Tool Permission Policies', () => {
    it('lists default tool policies with require_approval for dangerous tools', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Policy Test', systemPrompt: 'Test', toolsAllowed: ['calculate', 'http_request'] });
      const id = created.body.data._id;

      const res = await request.get(`/api/v1/agents/${id}/tools/policies`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id));
      expect(res.status).toBe(200);
      const policies = res.body.data;
      const httpRequest = policies.find((p: any) => p.toolName === 'http_request');
      expect(httpRequest).toBeDefined();
      expect(httpRequest.policy).toBe('REQUIRE_APPROVAL');
      expect(httpRequest.source).toBe('DEFAULT');
      const calculate = policies.find((p: any) => p.toolName === 'calculate');
      expect(calculate).toBeDefined();
      expect(calculate.policy).toBe('ALLOW');
      expect(calculate.source).toBe('DEFAULT');
    });

    it('allows owner to override tool policy to DENY', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Policy Override', systemPrompt: 'Test', toolsAllowed: ['calculate'] });
      const id = created.body.data._id;

      const res = await request.put(`/api/v1/agents/${id}/tools/policies`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ toolName: 'calculate', policy: 'DENY' });
      expect(res.status).toBe(200);
      expect(res.body.data.toolName).toBe('calculate');
      expect(res.body.data.policy).toBe('DENY');

      // Verify override is reflected in listing
      const listRes = await request.get(`/api/v1/agents/${id}/tools/policies`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id));
      const calcPolicy = listRes.body.data.find((p: any) => p.toolName === 'calculate');
      expect(calcPolicy.source).toBe('OVERRIDE');
      expect(calcPolicy.policy).toBe('DENY');
    });

    it('denies tool execution when policy is DENY', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Deny Test', systemPrompt: 'Test', toolsAllowed: ['calculate'] });
      const id = created.body.data._id;

      await request.put(`/api/v1/agents/${id}/tools/policies`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ toolName: 'calculate', policy: 'DENY' });

      const res = await request.post(`/api/v1/agents/${id}/test`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ invocation: { toolName: 'calculate', arguments: { expression: '2 + 2' } } });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('TOOL_DENIED_BY_POLICY');
    });

    it('editor cannot override tool policies (AGENT_MANAGE required)', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Editor Policy', systemPrompt: 'Test', toolsAllowed: ['calculate'] });
      const id = created.body.data._id;

      const res = await request.put(`/api/v1/agents/${id}/tools/policies`)
        .set(auth(editorToken)).set(wsHeader(ws1Id))
                .send({ toolName: 'calculate', policy: 'DENY' });
      expect(res.status).toBe(403);
    });
  });

  describe('Approval Required Flow', () => {
    it('http_request tool requires approval', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Approval Agent', systemPrompt: 'Test', toolsAllowed: ['http_request'] });
      const id = created.body.data._id;

      const res = await request.post(`/api/v1/agents/${id}/test`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ invocation: { toolName: 'http_request', arguments: { url: 'https://api.example.com/test', method: 'GET' } } });
      expect(res.status).toBe(202);
      expect(res.body.data.approvalRequired).toBe(true);
      expect(res.body.data.approval).toBeDefined();
      expect(res.body.data.run.status).toBe('WAITING_APPROVAL');
    });

    it('executes dangerous tool after approval is granted', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Approval Execute', systemPrompt: 'Test', toolsAllowed: ['http_request'] });
      const id = created.body.data._id;

      const testRes = await request.post(`/api/v1/agents/${id}/test`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ invocation: { toolName: 'http_request', arguments: { url: 'https://api.example.com/test', method: 'GET' } } });
      expect(testRes.status).toBe(202);
      const approvalId = testRes.body.data.approval._id;

      const approveRes = await request.post(`/api/v1/agents/${id}/approve`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ approvalId, decision: 'APPROVE' });
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.approval.status).toBe('APPROVED');
      expect(approveRes.body.data.run.status).toBe('SUCCEEDED');
      expect(approveRes.body.data.run.toolCalls[0].status).toBe('SUCCEEDED');
    });

    it('rejects approval with wrong decision', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Reject Flow', systemPrompt: 'Test', toolsAllowed: ['http_request'] });
      const id = created.body.data._id;

      const testRes = await request.post(`/api/v1/agents/${id}/test`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ invocation: { toolName: 'http_request', arguments: { url: 'https://api.example.com/test', method: 'GET' } } });
      const approvalId = testRes.body.data.approval._id;

      const rejectRes = await request.post(`/api/v1/agents/${id}/approve`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ approvalId, decision: 'REJECT', reason: 'Security concern' });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.approval.status).toBe('REJECTED');
      expect(rejectRes.body.data.approval.reason).toBe('Security concern');
    });

    it('executes allowed tools (calculate) without approval', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'No Approval', systemPrompt: 'Test', toolsAllowed: ['calculate'] });
      const id = created.body.data._id;

      const res = await request.post(`/api/v1/agents/${id}/test`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ invocation: { toolName: 'calculate', arguments: { expression: '10 + 20 * 2' } } });
      expect(res.status).toBe(201);
      expect(res.body.data.approvalRequired).toBe(false);
      expect(res.body.data.run.status).toBe('SUCCEEDED');
      expect(res.body.data.run.toolCalls[0].status).toBe('SUCCEEDED');
    });

    it('approval endpoint rejects invalid approval id', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Bad Approval', systemPrompt: 'Test', toolsAllowed: ['calculate'] });
      const id = created.body.data._id;

      const res = await request.post(`/api/v1/agents/${id}/approve`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
                .send({ approvalId: new Types.ObjectId().toString(), decision: 'APPROVE' });
      expect(res.status).toBe(404);
    });
  });

  describe('Memory Persistence', () => {
    it('returns empty memory list for a fresh agent', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Memory Agent', systemPrompt: 'Test', toolsAllowed: ['calculate'], memoryEnabled: true });
      const id = created.body.data._id;

      const memRes = await request.get(`/api/v1/agents/${id}/memory`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id));
      expect(memRes.status).toBe(200);
      expect(memRes.body.data).toEqual([]);
    });

    it('retrieves memory records when they exist', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Memory Agent 2', systemPrompt: 'Test', toolsAllowed: ['calculate'], memoryEnabled: true });
      const id = created.body.data._id;

      // Simulate memory stored by the autonomous agent path
      await AgentMemoryModel.create({
        agentId: new Types.ObjectId(id),
        workspaceId: new Types.ObjectId(ws1Id),
        scope: 'WORKSPACE',
        key: 'last_output',
        value: 'Tool execution complete with result: 4',
      });

      const memRes = await request.get(`/api/v1/agents/${id}/memory`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id));
      expect(memRes.status).toBe(200);
      expect(memRes.body.data.length).toBe(1);
      expect(memRes.body.data[0].key).toBe('last_output');
      expect(memRes.body.data[0].scope).toBe('WORKSPACE');
      expect(memRes.body.data[0].value).toBe('Tool execution complete with result: 4');
    });

    it('isolates memory records between workspaces', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Isolation Agent', systemPrompt: 'Test', toolsAllowed: ['calculate'] });
      const id = created.body.data._id;

      await AgentMemoryModel.create({
        agentId: new Types.ObjectId(id),
        workspaceId: new Types.ObjectId(ws1Id),
        scope: 'WORKSPACE',
        key: 'last_output',
        value: 'ws1-data',
      });

      // ws1 has the memory record
      const ws1Mem = await request.get(`/api/v1/agents/${id}/memory`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id));
      expect(ws1Mem.status).toBe(200);
      expect(ws1Mem.body.data.length).toBe(1);
      expect(ws1Mem.body.data[0].value).toBe('ws1-data');

      // ws2 has no memory records for this agent
      const ws2Mem = await request.get(`/api/v1/agents/${id}/memory`)
        .set(auth(ownerToken)).set(wsHeader(ws2Id));
      expect(ws2Mem.status).toBe(200);
      expect(ws2Mem.body.data.length).toBe(0);
    });
  });

  describe('Execution Trace', () => {
    it('records execution trace with tool calls', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Trace Agent', systemPrompt: 'Test', toolsAllowed: ['calculate'] });
      const id = created.body.data._id;

      const testRes = await request.post(`/api/v1/agents/${id}/test`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ invocation: { toolName: 'calculate', arguments: { expression: '2 + 2' } } });
      expect(testRes.status).toBe(201);
      expect(testRes.body.data.approvalRequired).toBe(false);

      // The run is embedded in the response
      const run = testRes.body.data.run;
      expect(run.status).toBe('SUCCEEDED');
      expect(run.trace.length).toBe(2);
      expect(run.trace[0].action).toBe('tool_call');
      expect(run.trace[1].action).toBe('tool_result');
      expect(run.tokenUsage).toBeDefined();
      expect(run.tokenUsage.totalTokens).toBe(0);
      expect(run.toolCalls.length).toBe(1);
      expect(run.toolCalls[0].toolName).toBe('calculate');
      expect(run.toolCalls[0].status).toBe('SUCCEEDED');
    });

    it('lists agent runs via GET /:id/runs', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Runs List', systemPrompt: 'Test', toolsAllowed: ['calculate'] });
      const id = created.body.data._id;

      await request.post(`/api/v1/agents/${id}/test`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ invocation: { toolName: 'calculate', arguments: { expression: '1 + 1' } } });
      await request.post(`/api/v1/agents/${id}/test`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ invocation: { toolName: 'calculate', arguments: { expression: '2 + 2' } } });

      const runsRes = await request.get(`/api/v1/agents/${id}/runs`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id));
      expect(runsRes.status).toBe(200);
      expect(runsRes.body.data.length).toBe(2);
      expect(runsRes.body.data[0].status).toBe('SUCCEEDED');
      expect(runsRes.body.data[0].toolCalls.length).toBe(1);
    });

    it('records trace events for denied tools', async () => {
      const created = await request.post('/api/v1/agents')
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ name: 'Deny Trace', systemPrompt: 'Test', toolsAllowed: ['calculate'] });
      const id = created.body.data._id;

      await request.put(`/api/v1/agents/${id}/tools/policies`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ toolName: 'calculate', policy: 'DENY' });

      const testRes = await request.post(`/api/v1/agents/${id}/test`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id))
        .send({ invocation: { toolName: 'calculate', arguments: { expression: '2 + 2' } } });
      expect(testRes.status).toBe(403);

      const runsRes = await request.get(`/api/v1/agents/${id}/runs`)
        .set(auth(ownerToken)).set(wsHeader(ws1Id));
      expect(runsRes.status).toBe(200);
      const run = runsRes.body.data[0];
      expect(run.status).toBe('FAILED');
      expect(run.trace.length).toBeGreaterThan(0);
      expect(run.toolCalls[0].status).toBe('DENIED');
    });
  });
});
