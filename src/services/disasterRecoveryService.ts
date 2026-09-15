import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowVersionModel } from '../models/WorkflowVersionModel.js';
import { APIKeyModel } from '../models/APIKeyModel.js';
import { WebhookModel } from '../models/WebhookModel.js';
import { createAuditLog } from './auditService.js';
import type { ExecutionQueue } from '../queues/executionQueue.js';
import type { WebhookQueue } from '../queues/webhookQueue.js';

export interface MaintenanceModeState {
  enabled: boolean;
  reason?: string;
  enabledAt?: string;
  enabledBy?: string;
}

let globalMaintenanceMode: MaintenanceModeState = {
  enabled: false,
};

export function getMaintenanceMode(): MaintenanceModeState {
  return { ...globalMaintenanceMode };
}

export async function setMaintenanceMode(
  enabled: boolean,
  actorUserId: string,
  options: {
    reason?: string;
    pauseQueues?: boolean;
    executionQueue?: ExecutionQueue;
    webhookQueue?: WebhookQueue;
  } = {},
): Promise<MaintenanceModeState> {
  const previous = { ...globalMaintenanceMode };
  const now = new Date().toISOString();

  globalMaintenanceMode = {
    enabled,
    ...(enabled ? { reason: options.reason ?? 'Scheduled maintenance', enabledAt: now, enabledBy: actorUserId } : {}),
  };

  if (options.pauseQueues) {
    if (enabled) {
      if (options.executionQueue?.pause) await options.executionQueue.pause();
      if (options.webhookQueue?.pause) await options.webhookQueue.pause();
    } else {
      if (options.executionQueue?.resume) await options.executionQueue.resume();
      if (options.webhookQueue?.resume) await options.webhookQueue.resume();
    }
  }

  await createAuditLog({
    action: 'MAINTENANCE_MODE_UPDATED',
    userId: actorUserId,
    resource: 'system',
    metadata: {
      previous,
      current: globalMaintenanceMode,
    },
  });

  return getMaintenanceMode();
}

export interface DisasterRecoverySnapshot {
  version: string;
  format: 'workflow-engine-backup-v1';
  createdAt: string;
  workspaceId?: string;
  checksum: string;
  data: {
    workspaces: any[];
    workflows: any[];
    workflowVersions: any[];
    apiKeys: any[];
    webhooks: any[];
  };
  counts: {
    workspaces: number;
    workflows: number;
    workflowVersions: number;
    apiKeys: number;
    webhooks: number;
  };
}

export interface SnapshotValidationResult {
  valid: boolean;
  checksumValid: boolean;
  countsMatch: boolean;
  errors: string[];
}

export async function createDisasterRecoverySnapshot(
  options: {
    workspaceId?: string;
    actorUserId?: string;
  } = {},
): Promise<DisasterRecoverySnapshot> {
  const wsFilter = options.workspaceId && Types.ObjectId.isValid(options.workspaceId)
    ? { workspaceId: new Types.ObjectId(options.workspaceId) }
    : {};
  const wsSelfFilter = options.workspaceId && Types.ObjectId.isValid(options.workspaceId)
    ? { _id: new Types.ObjectId(options.workspaceId) }
    : {};

  const [workspaces, workflows, workflowVersions, apiKeys, webhooks] = await Promise.all([
    WorkspaceModel.find(wsSelfFilter).lean(),
    WorkflowModel.find(wsFilter).lean(),
    options.workspaceId
      ? WorkflowVersionModel.find({}).lean() // We can filter by matching workflowIds below
      : WorkflowVersionModel.find({}).lean(),
    APIKeyModel.find(wsFilter).select('-secret').lean(),
    WebhookModel.find(wsFilter).select('-secret').lean(),
  ]);

  const workflowIdSet = new Set(workflows.map(w => w._id.toString()));
  const filteredVersions = options.workspaceId
    ? workflowVersions.filter(v => workflowIdSet.has(v.workflowId.toString()))
    : workflowVersions;

  const data = {
    workspaces,
    workflows,
    workflowVersions: filteredVersions,
    apiKeys,
    webhooks,
  };

  const payloadString = JSON.stringify(data);
  const checksum = crypto.createHash('sha256').update(payloadString).digest('hex');
  const createdAt = new Date().toISOString();

  const snapshot: DisasterRecoverySnapshot = {
    version: '1.0.0',
    format: 'workflow-engine-backup-v1',
    createdAt,
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    checksum,
    data,
    counts: {
      workspaces: workspaces.length,
      workflows: workflows.length,
      workflowVersions: filteredVersions.length,
      apiKeys: apiKeys.length,
      webhooks: webhooks.length,
    },
  };

  if (options.actorUserId) {
    await createAuditLog({
      action: 'DISASTER_RECOVERY_SNAPSHOT_CREATED',
      userId: options.actorUserId,
      workspaceId: options.workspaceId,
      resource: 'system',
      metadata: {
        checksum,
        counts: snapshot.counts,
      },
    });
  }

  return snapshot;
}

export function validateDisasterRecoverySnapshot(snapshot: any): SnapshotValidationResult {
  const errors: string[] = [];

  if (!snapshot || typeof snapshot !== 'object') {
    return { valid: false, checksumValid: false, countsMatch: false, errors: ['Snapshot is not a valid object'] };
  }

  if (snapshot.format !== 'workflow-engine-backup-v1') {
    errors.push(`Unsupported snapshot format: ${snapshot.format}`);
  }

  if (!snapshot.data || typeof snapshot.data !== 'object') {
    errors.push('Snapshot missing data payload');
  }

  let checksumValid = false;
  if (snapshot.data && snapshot.checksum) {
    const computedChecksum = crypto.createHash('sha256').update(JSON.stringify(snapshot.data)).digest('hex');
    checksumValid = computedChecksum === snapshot.checksum;
    if (!checksumValid) {
      errors.push(`Checksum mismatch: expected ${snapshot.checksum}, calculated ${computedChecksum}`);
    }
  } else {
    errors.push('Snapshot missing checksum or data payload');
  }

  let countsMatch = false;
  if (snapshot.counts && snapshot.data) {
    const expected = snapshot.counts;
    const actual = {
      workspaces: Array.isArray(snapshot.data.workspaces) ? snapshot.data.workspaces.length : -1,
      workflows: Array.isArray(snapshot.data.workflows) ? snapshot.data.workflows.length : -1,
      workflowVersions: Array.isArray(snapshot.data.workflowVersions) ? snapshot.data.workflowVersions.length : -1,
      apiKeys: Array.isArray(snapshot.data.apiKeys) ? snapshot.data.apiKeys.length : -1,
      webhooks: Array.isArray(snapshot.data.webhooks) ? snapshot.data.webhooks.length : -1,
    };

    countsMatch = (
      expected.workspaces === actual.workspaces &&
      expected.workflows === actual.workflows &&
      expected.workflowVersions === actual.workflowVersions &&
      expected.apiKeys === actual.apiKeys &&
      expected.webhooks === actual.webhooks
    );

    if (!countsMatch) {
      errors.push(`Counts mismatch: declared ${JSON.stringify(expected)} vs actual ${JSON.stringify(actual)}`);
    }
  }

  return {
    valid: errors.length === 0 && checksumValid && countsMatch,
    checksumValid,
    countsMatch,
    errors,
  };
}
