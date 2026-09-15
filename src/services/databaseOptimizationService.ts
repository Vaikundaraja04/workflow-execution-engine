import mongoose from 'mongoose';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { WebhookDeliveryModel } from '../models/WebhookDeliveryModel.js';
import { DeadLetterModel } from '../models/DeadLetterModel.js';
import { APIKeyModel } from '../models/APIKeyModel.js';
import { WebhookModel } from '../models/WebhookModel.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../models/WorkspaceMemberModel.js';

export interface IndexInfo {
  name: string;
  key: Record<string, number | string>;
  unique?: boolean;
}

export interface CollectionOptimizationInfo {
  collection: string;
  documentCount: number;
  indexes: IndexInfo[];
  recommendedIndexes: Array<{
    key: Record<string, number | string>;
    reason: string;
    exists: boolean;
  }>;
  status: 'OPTIMAL' | 'ATTENTION_NEEDED';
}

export interface DatabaseOptimizationReport {
  timestamp: string;
  databaseName: string;
  connectionState: string;
  collections: CollectionOptimizationInfo[];
  totalIndexes: number;
  summary: {
    status: 'OPTIMAL' | 'NEEDS_OPTIMIZATION';
    recommendationsCount: number;
  };
}

const RECOMMENDED_COLLECTION_INDEXES: Record<string, Array<{ key: Record<string, number | string>; reason: string }>> = {
  workflowexecutions: [
    { key: { workflowId: 1, idempotencyKey: 1 }, reason: 'Unique idempotency enforcement' },
    { key: { workspaceId: 1, status: 1, createdAt: -1 }, reason: 'Filtered execution listing and metrics' },
    { key: { status: 1, nextRetryAt: 1 }, reason: 'Worker polling and retry queries' },
  ],
  auditlogs: [
    { key: { workspaceId: 1, createdAt: -1 }, reason: 'Workspace audit log queries' },
    { key: { action: 1 }, reason: 'Security center action filtering' },
  ],
  webhookdeliveries: [
    { key: { webhookId: 1, createdAt: -1 }, reason: 'Webhook delivery history' },
    { key: { status: 1, nextRetryAt: 1 }, reason: 'Webhook retry worker queue' },
  ],
  deadletters: [
    { key: { executionId: 1 }, reason: 'Unique dead letter execution lookup' },
    { key: { workspaceId: 1, failedAt: -1 }, reason: 'Dead letter listing by workspace' },
  ],
  workflows: [
    { key: { workspaceId: 1, slug: 1 }, reason: 'Workspace slug resolution' },
  ],
  workspaces: [
    { key: { slug: 1 }, reason: 'Unique workspace slug resolution' },
  ],
  workspacemembers: [
    { key: { workspaceId: 1, userId: 1 }, reason: 'Unique workspace membership' },
  ],
  apikeys: [
    { key: { keyHash: 1 }, reason: 'API key authentication lookup' },
    { key: { workspaceId: 1 }, reason: 'API key listing by workspace' },
  ],
  webhooks: [
    { key: { workspaceId: 1 }, reason: 'Webhook listing by workspace' },
  ],
};

function keysMatch(k1: Record<string, any>, k2: Record<string, any>): boolean {
  const e1 = Object.entries(k1);
  const e2 = Object.entries(k2);
  if (e1.length !== e2.length) return false;
  for (let i = 0; i < e1.length; i++) {
    const pair1 = e1[i];
    const pair2 = e2[i];
    if (!pair1 || !pair2) return false;
    if (pair1[0] !== pair2[0] || pair1[1] !== pair2[1]) return false;
  }
  return true;
}

export async function getDatabaseOptimizationReport(): Promise<DatabaseOptimizationReport> {
  const models = [
    { name: 'workflowexecutions', model: WorkflowExecutionModel },
    { name: 'auditlogs', model: AuditLogModel },
    { name: 'webhookdeliveries', model: WebhookDeliveryModel },
    { name: 'deadletters', model: DeadLetterModel },
    { name: 'workflows', model: WorkflowModel },
    { name: 'workspaces', model: WorkspaceModel },
    { name: 'workspacemembers', model: WorkspaceMemberModel },
    { name: 'apikeys', model: APIKeyModel },
    { name: 'webhooks', model: WebhookModel },
  ];

  let totalIndexes = 0;
  let missingRecommendationsCount = 0;
  const collectionReports: CollectionOptimizationInfo[] = [];

  for (const item of models) {
    let count = 0;
    let rawIndexes: any[] = [];
    try {
      count = await (item.model as any).countDocuments({});
      rawIndexes = await item.model.collection.indexes();
    } catch {
      // If collection doesn't exist yet in db
    }

    const indexes: IndexInfo[] = rawIndexes.map(idx => ({
      name: idx.name ?? '',
      key: idx.key ?? {},
      unique: idx.unique ?? false,
    }));
    totalIndexes += indexes.length;

    const recommended = RECOMMENDED_COLLECTION_INDEXES[item.name] ?? [];
    const recommendedWithStatus = recommended.map(rec => {
      const exists = indexes.some(idx => keysMatch(idx.key, rec.key));
      if (!exists) missingRecommendationsCount += 1;
      return {
        ...rec,
        exists,
      };
    });

    const status: 'OPTIMAL' | 'ATTENTION_NEEDED' = recommendedWithStatus.every(r => r.exists)
      ? 'OPTIMAL'
      : 'ATTENTION_NEEDED';

    collectionReports.push({
      collection: item.name,
      documentCount: count,
      indexes,
      recommendedIndexes: recommendedWithStatus,
      status,
    });
  }

  const dbName = mongoose.connection.db?.databaseName ?? 'unknown';
  const readyStateNames = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const connectionState = readyStateNames[mongoose.connection.readyState] ?? 'unknown';

  return {
    timestamp: new Date().toISOString(),
    databaseName: dbName,
    connectionState,
    collections: collectionReports,
    totalIndexes,
    summary: {
      status: missingRecommendationsCount === 0 ? 'OPTIMAL' : 'NEEDS_OPTIMIZATION',
      recommendationsCount: missingRecommendationsCount,
    },
  };
}
