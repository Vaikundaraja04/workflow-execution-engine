import { createHash } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowVersionModel } from '../models/WorkflowVersionModel.js';
import type { VersionStatus } from '../models/WorkflowVersionModel.js';
import type { WorkflowDefinition, WorkflowNode } from '../types/workflow.js';
import { tenantScope } from './tenantScope.js';

export interface WorkflowVersionView {
  id: string;
  workflowId: string;
  workspaceId?: string;
  versionNumber: number;
  status: VersionStatus;
  definition: WorkflowDefinition;
  definitionHash: string;
  createdBy?: string;
  sourceVersionId?: string;
  changeSummary?: string;
  createdAt: string;
}

export interface VersionComparison {
  from: { versionId: string; versionNumber: number };
  to: { versionId: string; versionNumber: number };
  identical: boolean;
  nodes: { added: string[]; removed: string[]; changed: Array<{ id: string; fields: Array<{ field: string; from: unknown; to: unknown }> }> };
  edges: { added: string[]; removed: string[] };
}

export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(',')}}`;
  }
  return 'null';
}

function edgeKey(edge: { source: string; target: string; condition?: 'true' | 'false' | undefined }): string {
  return `${edge.source}->${edge.target}${edge.condition ? ` (${edge.condition})` : ''}`;
}

export function normalizeDefinition(definition: WorkflowDefinition): WorkflowDefinition {
  const nodes = [...definition.nodes]
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const edges = [...definition.edges]
    .sort((left, right) => {
      const leftKey = edgeKey(left);
      const rightKey = edgeKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  return { nodes, edges };
}

export function hashDefinition(definition: WorkflowDefinition): string {
  return createHash('sha256').update(canonicalize(normalizeDefinition(definition))).digest('hex');
}

interface VersionShape {
  _id: Types.ObjectId;
  workflowId: Types.ObjectId;
  workspaceId?: Types.ObjectId | null;
  versionNumber: number;
  status?: VersionStatus;
  definition: WorkflowDefinition;
  definitionHash?: string;
  createdBy?: Types.ObjectId | null;
  sourceVersionId?: Types.ObjectId | null;
  changeSummary?: string | null;
  createdAt: Date;
}

export function toVersionView(version: VersionShape): WorkflowVersionView {
  const view: WorkflowVersionView = {
    id: version._id.toString(),
    workflowId: version.workflowId.toString(),
    versionNumber: version.versionNumber,
    status: version.status ?? 'PUBLISHED',
    definition: version.definition,
    definitionHash: version.definitionHash ?? hashDefinition(version.definition),
    createdAt: version.createdAt.toISOString(),
  };
  if (version.workspaceId) view.workspaceId = version.workspaceId.toString();
  if (version.createdBy) view.createdBy = version.createdBy.toString();
  if (version.sourceVersionId) view.sourceVersionId = version.sourceVersionId.toString();
  if (version.changeSummary) view.changeSummary = version.changeSummary;
  return view;
}

async function requireWorkflowInTenant(workflowId: string, userId: string, workspaceId: string) {
  if (!Types.ObjectId.isValid(workflowId)) throw new Error('INVALID_WORKFLOW_ID');
  const workflow = await WorkflowModel.findOne({ _id: workflowId, ...tenantScope(userId, workspaceId) });
  if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
  return workflow;
}

async function findVersion(
  workflowId: string,
  reference: string,
  session?: mongoose.ClientSession,
) {
  const numeric = Number(reference);
  if (Number.isInteger(numeric) && numeric > 0) {
    return WorkflowVersionModel.findOne({ workflowId, versionNumber: numeric }).session(session ?? null);
  }
  if (!Types.ObjectId.isValid(reference)) throw new Error('VERSION_NOT_FOUND');
  return WorkflowVersionModel.findOne({ _id: reference, workflowId }).session(session ?? null);
}

export async function listWorkflowVersions(
  workflowId: string,
  userId: string,
  workspaceId: string,
): Promise<WorkflowVersionView[]> {
  await requireWorkflowInTenant(workflowId, userId, workspaceId);
  const versions = await WorkflowVersionModel.find({ workflowId }).sort({ versionNumber: 1 }).lean();
  return versions.map(toVersionView);
}

export async function getWorkflowVersion(
  workflowId: string,
  reference: string,
  userId: string,
  workspaceId: string,
): Promise<WorkflowVersionView> {
  await requireWorkflowInTenant(workflowId, userId, workspaceId);
  const version = await findVersion(workflowId, reference);
  if (!version) throw new Error('VERSION_NOT_FOUND');
  return toVersionView(version);
}

export async function restoreWorkflowVersion(
  workflowId: string,
  reference: string,
  userId: string,
  workspaceId: string,
  changeSummary?: string,
): Promise<WorkflowVersionView> {
  if (!Types.ObjectId.isValid(workflowId)) throw new Error('INVALID_WORKFLOW_ID');

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const workflow = await WorkflowModel.findOne({ _id: workflowId, ...tenantScope(userId, workspaceId) })
      .session(session);
    if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');

    const source = await findVersion(workflowId, reference, session);
    if (!source) throw new Error('VERSION_NOT_FOUND');

    const definition = JSON.parse(JSON.stringify(source.definition)) as WorkflowDefinition;
    const nextVersion = workflow.latestVersionNumber + 1;
    const [created] = await WorkflowVersionModel.create([{
      workflowId: workflow._id,
      ...(workflow.workspaceId ? { workspaceId: workflow.workspaceId } : {}),
      versionNumber: nextVersion,
      definition: JSON.parse(JSON.stringify(definition)),
      definitionHash: hashDefinition(definition),
      createdBy: new Types.ObjectId(userId),
      sourceVersionId: source._id,
      changeSummary: changeSummary ?? `Restored from version ${source.versionNumber}`,
      status: 'PUBLISHED',
    }], { session });
    if (!created) throw new Error('VERSION_CONFLICT');

    workflow.draftDefinition = definition;
    workflow.status = 'PUBLISHED';
    workflow.latestVersionNumber = nextVersion;
    workflow.publishedVersionId = created._id;
    await workflow.save({ session });

    await session.commitTransaction();
    return toVersionView(created);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

function nodeFieldChanges(before: WorkflowNode, after: WorkflowNode) {
  const fields: Array<{ field: string; from: unknown; to: unknown }> = [];
  if (before.type !== after.type) fields.push({ field: 'type', from: before.type, to: after.type });
  const beforeConfig = before.config ?? {};
  const afterConfig = after.config ?? {};
  const keys = new Set([...Object.keys(beforeConfig), ...Object.keys(afterConfig)]);
  for (const key of [...keys].sort()) {
    const left = beforeConfig[key];
    const right = afterConfig[key];
    if (canonicalize(left) !== canonicalize(right)) {
      fields.push({ field: `config.${key}`, from: left, to: right });
    }
  }
  return fields;
}

export function diffVersions(from: VersionShape, to: VersionShape): VersionComparison {
  const fromNodes = new Map(from.definition.nodes.map((node) => [node.id, node]));
  const toNodes = new Map(to.definition.nodes.map((node) => [node.id, node]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: Array<{ id: string; fields: Array<{ field: string; from: unknown; to: unknown }> }> = [];

  for (const id of toNodes.keys()) if (!fromNodes.has(id)) added.push(id);
  for (const [id, node] of fromNodes) {
    const target = toNodes.get(id);
    if (!target) {
      removed.push(id);
      continue;
    }
    const fields = nodeFieldChanges(node, target);
    if (fields.length > 0) changed.push({ id, fields });
  }

  const fromEdges = new Set(from.definition.edges.map(edgeKey));
  const toEdges = new Set(to.definition.edges.map(edgeKey));
  const edgesAdded = [...toEdges].filter((key) => !fromEdges.has(key)).sort();
  const edgesRemoved = [...fromEdges].filter((key) => !toEdges.has(key)).sort();

  added.sort();
  removed.sort();
  changed.sort((left, right) => (left.id < right.id ? -1 : 1));

  return {
    from: { versionId: from._id.toString(), versionNumber: from.versionNumber },
    to: { versionId: to._id.toString(), versionNumber: to.versionNumber },
    identical: added.length === 0 && removed.length === 0 && changed.length === 0
      && edgesAdded.length === 0 && edgesRemoved.length === 0,
    nodes: { added, removed, changed },
    edges: { added: edgesAdded, removed: edgesRemoved },
  };
}

export async function compareWorkflowVersions(
  workflowId: string,
  fromReference: string,
  toReference: string,
  userId: string,
  workspaceId: string,
): Promise<VersionComparison> {
  await requireWorkflowInTenant(workflowId, userId, workspaceId);
  const from = await findVersion(workflowId, fromReference);
  if (!from) throw new Error('VERSION_NOT_FOUND');
  const to = await findVersion(workflowId, toReference);
  if (!to) throw new Error('VERSION_NOT_FOUND');
  return diffVersions(from, to);
}
