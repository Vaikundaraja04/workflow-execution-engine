import mongoose, { Types } from 'mongoose';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowVersionModel } from '../models/WorkflowVersionModel.js';
import type { WorkflowDefinition } from '../types/workflow.js';
import { validateGraph } from '../engine/validateGraph.js';
import { WorkflowDefinitionSchema } from '../schemas/workflowSchema.js';
import { tenantScope } from './tenantScope.js';
import { recordWorkflowCreated } from './analyticsService.js';
import { hashDefinition } from './versionService.js';

function assertValidWorkflowId(id: string): void {
  if (!Types.ObjectId.isValid(id)) {
    throw new Error('INVALID_WORKFLOW_ID');
  }
}

export async function createWorkflow(name: string, definition: WorkflowDefinition, ownerId: string, workspaceId: string) {
  const doc = await WorkflowModel.create({
    name: name.trim(),
    draftDefinition: definition,
    status: 'DRAFT',
    latestVersionNumber: 0,
    ownerId: new Types.ObjectId(ownerId),
    createdBy: new Types.ObjectId(ownerId),
    workspaceId: new Types.ObjectId(workspaceId),
  });
  await recordWorkflowCreated(workspaceId);
  return doc.toObject();
}

export async function getWorkflow(id: string, ownerId: string, workspaceId: string) {
  assertValidWorkflowId(id);
  const doc = await WorkflowModel.findOne({ _id: id, ...tenantScope(ownerId, workspaceId) });
  if (!doc) throw new Error('WORKFLOW_NOT_FOUND');
  return doc.toObject();
}

export async function updateDraft(id: string, updates: { name?: string; definition?: WorkflowDefinition }, ownerId: string, workspaceId: string) {
  assertValidWorkflowId(id);
  const doc = await WorkflowModel.findOne({ _id: id, ...tenantScope(ownerId, workspaceId) });
  if (!doc) throw new Error('WORKFLOW_NOT_FOUND');

  if (updates.name !== undefined) doc.name = updates.name.trim();
  if (updates.definition !== undefined) {
    doc.draftDefinition = updates.definition;
  }
  if (doc.status === 'PUBLISHED') doc.status = 'DRAFT';
  await doc.save();
  return doc.toObject();
}

export async function validateDraft(id: string, ownerId: string, workspaceId: string) {
  const wf = await getWorkflow(id, ownerId, workspaceId);
  const draft: unknown = JSON.parse(JSON.stringify(wf.draftDefinition));
  const schemaResult = WorkflowDefinitionSchema.safeParse(draft);

  if (!schemaResult.success) {
    return {
      valid: false,
      schemaErrors: schemaResult.error.issues,
      graphErrors: [],
    };
  }

  const graphErrors = validateGraph(schemaResult.data);
  return {
    valid: graphErrors.length === 0,
    schemaErrors: [],
    graphErrors,
  };
}

export async function publishWorkflow(
  id: string,
  ownerId: string,
  workspaceId: string,
  changeSummary?: string,
) {
  assertValidWorkflowId(id);
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const wf = await WorkflowModel.findOne({ _id: id, ...tenantScope(ownerId, workspaceId) }).session(session);
    if (!wf) throw new Error('WORKFLOW_NOT_FOUND');

    const parsedDraft = JSON.parse(JSON.stringify(wf.draftDefinition));
    const schemaResult = WorkflowDefinitionSchema.safeParse(parsedDraft);
    if (!schemaResult.success) {
      throw new Error('INVALID_WORKFLOW_SCHEMA');
    }

    const graphErrors = validateGraph(schemaResult.data);
    if (graphErrors.length > 0) {
      throw new Error('INVALID_WORKFLOW_GRAPH');
    }

    const nextVersion = wf.latestVersionNumber + 1;
    const definition = JSON.parse(JSON.stringify(schemaResult.data));
    const [createdVersion] = await WorkflowVersionModel.create([{
      workflowId: wf._id,
      ...(wf.workspaceId ? { workspaceId: wf.workspaceId } : {}),
      versionNumber: nextVersion,
      definition,
      definitionHash: hashDefinition(definition),
      createdBy: new Types.ObjectId(ownerId),
      status: 'PUBLISHED',
      ...(changeSummary !== undefined ? { changeSummary } : {}),
    }], { session });

    if (!createdVersion) {
      throw new Error('VERSION_CONFLICT');
    }

    wf.status = 'PUBLISHED';
    wf.latestVersionNumber = nextVersion;
    wf.publishedVersionId = createdVersion._id;
    await wf.save({ session });

    await session.commitTransaction();
    return { versionNumber: nextVersion, definition: createdVersion.definition };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

