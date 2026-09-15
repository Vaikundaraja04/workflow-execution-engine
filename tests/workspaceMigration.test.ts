import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import {
  ensureUserWorkspace,
  backfillLegacyWorkspaceData,
} from '../src/services/workspaceService.js';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

beforeEach(async () => {
  await AuditLogModel.deleteMany({});
  await WorkflowExecutionModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await WorkspaceMemberModel.deleteMany({});
  await WorkspaceModel.deleteMany({});
  await UserModel.deleteMany({});
});
describe('Phase 3A migration helpers', () => {
  it('creates a personal workspace once and is idempotent', async () => {
    const user = await UserModel.create({ email: 'mig@example.com', passwordHash: 'x' });
    const first = await ensureUserWorkspace(user._id.toString());
    const second = await ensureUserWorkspace(user._id.toString());

    expect(second).toBe(first);
    expect(await WorkspaceModel.countDocuments({})).toBe(1);

    const workspace = await WorkspaceModel.findById(first);
    expect(workspace?.name).toBe('Personal');
    expect(workspace?.slug).toBe(`personal-${user._id.toString()}`);

    const membership = await WorkspaceMemberModel.findOne({ workspaceId: first, userId: user._id });
    expect(membership?.role).toBe('OWNER');

    const reloaded = await UserModel.findById(user._id);
    expect(reloaded?.defaultWorkspaceId?.toString()).toBe(first);
  });
  it('backfills legacy owner-scoped data into the tenant workspace', async () => {
    const user = await UserModel.create({ email: 'legacy@example.com', passwordHash: 'x' });

    const workflow = await WorkflowModel.create({
      name: 'legacy',
      draftDefinition: { nodes: [], edges: [] },
      status: 'DRAFT',
      latestVersionNumber: 0,
      ownerId: user._id,
    });
    const execution = await WorkflowExecutionModel.create({
      workflowId: workflow._id,
      ownerId: user._id,
      workflowVersionId: new Types.ObjectId(),
      versionNumber: 1,
      jobId: `legacy-job-${workflow._id.toString()}`,
      idempotencyKey: 'legacy-key',
      inputHash: '{}',
      input: {},
      status: 'QUEUED',
      attemptsMade: 0,
      statusHistory: [],
    });
    const audit = await AuditLogModel.create({
      action: 'WORKFLOW_CREATED',
      userId: user._id,
      resource: 'workflow',
      resourceId: workflow._id.toString(),
    });

    const summary = await backfillLegacyWorkspaceData();
    expect(summary.users).toBe(1);

    const defaultWorkspaceId = (await UserModel.findById(user._id))?.defaultWorkspaceId;
    expect((await WorkflowModel.findById(workflow._id))?.workspaceId?.toString())
      .toBe(defaultWorkspaceId?.toString());
    expect((await WorkflowModel.findById(workflow._id))?.createdBy?.toString())
      .toBe(user._id.toString());
    expect((await WorkflowExecutionModel.findById(execution._id))?.workspaceId?.toString())
      .toBe(defaultWorkspaceId?.toString());
    expect((await AuditLogModel.findById(audit._id))?.workspaceId?.toString())
      .toBe(defaultWorkspaceId?.toString());

    await backfillLegacyWorkspaceData();
    expect(await WorkspaceModel.countDocuments({})).toBe(1);
  });
});