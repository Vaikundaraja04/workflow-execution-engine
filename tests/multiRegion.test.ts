import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { RegionService } from '../src/services/regionService.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { RegionModel } from '../src/models/RegionModel.js';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';

describe('Multi-Region Functionality', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  }, 30000);

  beforeEach(async () => {
    await WorkspaceModel.deleteMany({});
    await RegionModel.deleteMany({});
  });

  it('should assign region to workspace based on strategy', async () => {
    const regionService = new RegionService();
    await RegionModel.create({
      name: 'US East (N. Virginia)',
      code: 'us-east-1',
      status: 'ACTIVE',
      endpoints: { api: 'https://us-east-1.api.internal' },
    });
    await RegionModel.create({
      name: 'Europe (Ireland)',
      code: 'eu-west-1',
      status: 'ACTIVE',
      endpoints: { api: 'https://eu-west-1.api.internal' },
    });

    const workspace = await WorkspaceModel.create({
      name: 'Test Workspace',
      slug: 'test-workspace',
      ownerId: new mongoose.Types.ObjectId(),
    });

    const assignedRegion = await regionService.assignRegionToWorkspace(workspace._id.toString());

    expect(['us-east-1', 'eu-west-1']).toContain(assignedRegion);
    const updatedWorkspace = await WorkspaceModel.findById(workspace._id);
    expect(updatedWorkspace?.region).toBe(assignedRegion);
  });

  it('should respect preferred region when assigning', async () => {
    const regionService = new RegionService();
    await RegionModel.create({
      name: 'US East (N. Virginia)',
      code: 'us-east-1',
      status: 'ACTIVE',
      endpoints: { api: 'https://us-east-1.api.internal' },
    });
    await RegionModel.create({
      name: 'Europe (Ireland)',
      code: 'eu-west-1',
      status: 'ACTIVE',
      endpoints: { api: 'https://eu-west-1.api.internal' },
    });

    const workspace = await WorkspaceModel.create({
      name: 'Test Workspace',
      slug: 'test-workspace',
      ownerId: new mongoose.Types.ObjectId(),
    });

    const assignedRegion = await regionService.assignRegionToWorkspace(workspace._id.toString(), 'eu-west-1');

    expect(assignedRegion).toBe('eu-west-1');
    const updatedWorkspace = await WorkspaceModel.findById(workspace._id);
    expect(updatedWorkspace?.region).toBe('eu-west-1');
  });

  it('should get workspace region', async () => {
    const regionService = new RegionService();
    await RegionModel.create({
      name: 'US East (N. Virginia)',
      code: 'us-east-1',
      status: 'ACTIVE',
      endpoints: { api: 'https://us-east-1.api.internal' },
    });

    const workspace = await WorkspaceModel.create({
      name: 'Test Workspace',
      slug: 'test-workspace',
      ownerId: new mongoose.Types.ObjectId(),
      region: 'us-east-1',
    });

    const region = await regionService.getWorkspaceRegion(workspace._id.toString());

    expect(region).toBe('us-east-1');
  });
});
