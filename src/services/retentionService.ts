import { Types } from 'mongoose';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { WebhookDeliveryModel } from '../models/WebhookDeliveryModel.js';
import { DeadLetterModel } from '../models/DeadLetterModel.js';
import { createAuditLog } from './auditService.js';

export interface RetentionPolicy {
  executionsRetentionDays: number;
  auditLogsRetentionDays: number;
  webhookDeliveriesRetentionDays: number;
  deadLettersRetentionDays: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  executionsRetentionDays: 90,
  auditLogsRetentionDays: 365,
  webhookDeliveriesRetentionDays: 90,
  deadLettersRetentionDays: 90,
};

export interface RetentionExecutionOptions {
  workspaceId?: string;
  dryRun?: boolean;
  policies?: Partial<RetentionPolicy>;
  actorUserId?: string;
}

export interface RetentionExecutionResult {
  dryRun: boolean;
  executedAt: string;
  workspaceId?: string;
  cutoffDates: {
    executions: string;
    auditLogs: string;
    webhookDeliveries: string;
    deadLetters: string;
  };
  deletedCounts: {
    executions: number;
    auditLogs: number;
    webhookDeliveries: number;
    deadLetters: number;
    total: number;
  };
}

function calculateCutoff(days: number): Date {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

export function getEffectiveRetentionPolicy(custom?: Partial<RetentionPolicy>): RetentionPolicy {
  return {
    executionsRetentionDays: custom?.executionsRetentionDays ?? DEFAULT_RETENTION_POLICY.executionsRetentionDays,
    auditLogsRetentionDays: custom?.auditLogsRetentionDays ?? DEFAULT_RETENTION_POLICY.auditLogsRetentionDays,
    webhookDeliveriesRetentionDays: custom?.webhookDeliveriesRetentionDays ?? DEFAULT_RETENTION_POLICY.webhookDeliveriesRetentionDays,
    deadLettersRetentionDays: custom?.deadLettersRetentionDays ?? DEFAULT_RETENTION_POLICY.deadLettersRetentionDays,
  };
}

export async function runDataRetention(
  options: RetentionExecutionOptions = {},
): Promise<RetentionExecutionResult> {
  const policy = getEffectiveRetentionPolicy(options.policies);
  const dryRun = options.dryRun ?? false;
  const executedAt = new Date().toISOString();

  const executionsCutoff = calculateCutoff(policy.executionsRetentionDays);
  const auditLogsCutoff = calculateCutoff(policy.auditLogsRetentionDays);
  const webhookDeliveriesCutoff = calculateCutoff(policy.webhookDeliveriesRetentionDays);
  const deadLettersCutoff = calculateCutoff(policy.deadLettersRetentionDays);

  const wsMatch = options.workspaceId && Types.ObjectId.isValid(options.workspaceId)
    ? { workspaceId: new Types.ObjectId(options.workspaceId) }
    : {};

  // 1. Workflow executions filter: only terminal states (SUCCEEDED, FAILED)
  const executionFilter: any = {
    ...wsMatch,
    status: { $in: ['SUCCEEDED', 'FAILED'] },
    createdAt: { $lt: executionsCutoff },
  };

  // 2. Audit logs filter
  const auditLogFilter: any = {
    ...wsMatch,
    createdAt: { $lt: auditLogsCutoff },
  };

  // 3. Webhook deliveries filter
  const webhookDeliveryFilter: any = {
    ...wsMatch,
    createdAt: { $lt: webhookDeliveriesCutoff },
  };

  // 4. Dead letters filter
  const deadLetterFilter: any = {
    ...wsMatch,
    failedAt: { $lt: deadLettersCutoff },
  };

  let executionsCount = 0;
  let auditLogsCount = 0;
  let webhookDeliveriesCount = 0;
  let deadLettersCount = 0;

  if (dryRun) {
    const [execs, audits, webhooks, deadLetters] = await Promise.all([
      WorkflowExecutionModel.countDocuments(executionFilter),
      AuditLogModel.countDocuments(auditLogFilter),
      WebhookDeliveryModel.countDocuments(webhookDeliveryFilter),
      DeadLetterModel.countDocuments(deadLetterFilter),
    ]);
    executionsCount = execs;
    auditLogsCount = audits;
    webhookDeliveriesCount = webhooks;
    deadLettersCount = deadLetters;
  } else {
    const [execRes, auditRes, webhookRes, deadLetterRes] = await Promise.all([
      WorkflowExecutionModel.deleteMany(executionFilter),
      AuditLogModel.deleteMany(auditLogFilter),
      WebhookDeliveryModel.deleteMany(webhookDeliveryFilter),
      DeadLetterModel.deleteMany(deadLetterFilter),
    ]);
    executionsCount = execRes.deletedCount;
    auditLogsCount = auditRes.deletedCount;
    webhookDeliveriesCount = webhookRes.deletedCount;
    deadLettersCount = deadLetterRes.deletedCount;

    if (options.actorUserId) {
      await createAuditLog({
        action: 'DATA_RETENTION_EXECUTED',
        userId: options.actorUserId,
        workspaceId: options.workspaceId,
        resource: 'system',
        metadata: {
          policy,
          deletedCounts: {
            executions: executionsCount,
            auditLogs: auditLogsCount,
            webhookDeliveries: webhookDeliveriesCount,
            deadLetters: deadLettersCount,
            total: executionsCount + auditLogsCount + webhookDeliveriesCount + deadLettersCount,
          },
        },
      });
    }
  }

  const result: RetentionExecutionResult = {
    dryRun,
    executedAt,
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    cutoffDates: {
      executions: executionsCutoff.toISOString(),
      auditLogs: auditLogsCutoff.toISOString(),
      webhookDeliveries: webhookDeliveriesCutoff.toISOString(),
      deadLetters: deadLettersCutoff.toISOString(),
    },
    deletedCounts: {
      executions: executionsCount,
      auditLogs: auditLogsCount,
      webhookDeliveries: webhookDeliveriesCount,
      deadLetters: deadLettersCount,
      total: executionsCount + auditLogsCount + webhookDeliveriesCount + deadLettersCount,
    },
  };

  return result;
}
