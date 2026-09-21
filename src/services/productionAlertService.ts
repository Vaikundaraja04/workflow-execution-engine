import mongoose, { Types } from 'mongoose';
import {
  ProductionAlertModel,
  PRODUCTION_ALERT_TYPES,
} from '../models/ProductionAlertModel.js';
import type {
  ProductionAlertType,
  ProductionAlertSeverity,
  ProductionAlertStatus,
  IProductionAlert,
} from '../models/ProductionAlertModel.js';
import { AIUsageModel } from '../models/AIUsageModel.js';
import { createAuditLog } from './auditService.js';
import type { OperationalSnapshot } from './observabilityCollectorService.js';

export interface ProductionAlertDTO {
  id: string;
  type: ProductionAlertType;
  severity: ProductionAlertSeverity;
  status: ProductionAlertStatus;
  workspaceId: string | null;
  title: string;
  details: string;
  value: number | null;
  threshold: number | null;
  scanId: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

type ProductionAlertDoc = IProductionAlert & { _id: Types.ObjectId };

export function toProductionAlertDTO(alert: ProductionAlertDoc): ProductionAlertDTO {
  return {
    id: alert._id.toString(),
    type: alert.type,
    severity: alert.severity,
    status: alert.status,
    workspaceId: alert.workspaceId ? alert.workspaceId.toString() : null,
    title: alert.title,
    details: alert.details,
    value: alert.value ?? null,
    threshold: alert.threshold ?? null,
    scanId: alert.scanId ? alert.scanId.toString() : null,
    acknowledgedAt: alert.acknowledgedAt ? alert.acknowledgedAt.toISOString() : null,
    acknowledgedBy: alert.acknowledgedBy ? alert.acknowledgedBy.toString() : null,
    createdAt: alert.createdAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString(),
  };
}

export interface AlertThresholds {
  readinessDrop: number;
  queueDepth: number;
  workerHeartbeatAgeMs: number;
  aiCostSpikeUsd: number;
}

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function alertThresholds(): AlertThresholds {
  return {
    readinessDrop: envNumber('READINESS_DROP_THRESHOLD', 5),
    queueDepth: envNumber('QUEUE_DEPTH_ALERT_THRESHOLD', 100),
    workerHeartbeatAgeMs: envNumber('WORKER_HEARTBEAT_ALERT_MS', 60_000),
    aiCostSpikeUsd: envNumber('AI_COST_SPIKE_USD', 10),
  };
}

export interface AlertEvaluationInput {
  workspaceId?: string;
  scanId?: string;
  score: number;
  delta: number | null;
  securityFailures: number;
  previousSecurityFailures: number | null;
  snapshot?: OperationalSnapshot;
  aiCostLastHourUsd?: number | null;
}

export interface AlertEvaluationResult {
  created: ProductionAlertType[];
  updated: ProductionAlertType[];
}

export interface AlertCandidate {
  type: ProductionAlertType;
  severity: ProductionAlertSeverity;
  title: string;
  details: string;
  value: number | null;
  threshold: number | null;
}

export interface ListAlertFilters {
  status?: string;
  type?: string;
  workspaceId?: string;
  limit?: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export class ProductionAlertService {
  private static instance: ProductionAlertService;
  public static getInstance(): ProductionAlertService {
    if (!ProductionAlertService.instance) {
      ProductionAlertService.instance = new ProductionAlertService();
    }
    return ProductionAlertService.instance;
  }

  private buildCandidates(input: AlertEvaluationInput, aiCostUsd: number | null): AlertCandidate[] {
    const thresholds = alertThresholds();
    const candidates: AlertCandidate[] = [];

    if (input.delta !== null && input.delta <= -thresholds.readinessDrop) {
      const severity: ProductionAlertSeverity =
        input.delta <= -thresholds.readinessDrop * 2 ? 'CRITICAL' : 'WARNING';
      candidates.push({
        type: 'READINESS_DROP',
        severity,
        title: `Readiness score dropped by ${Math.abs(input.delta)} points`,
        details: `Readiness score moved from ${round2(input.score - input.delta)} to ${input.score}.`,
        value: input.score,
        threshold: thresholds.readinessDrop,
      });
    }

    if (
      input.previousSecurityFailures !== null &&
      input.securityFailures > input.previousSecurityFailures
    ) {
      candidates.push({
        type: 'SECURITY_REGRESSION',
        severity: 'CRITICAL',
        title: 'Security findings regressed',
        details: `Security audit failures increased from ${input.previousSecurityFailures} to ${input.securityFailures}.`,
        value: input.securityFailures,
        threshold: input.previousSecurityFailures,
      });
    }

    const queue = input.snapshot?.queue;
    if (queue?.available && queue.depth >= thresholds.queueDepth) {
      candidates.push({
        type: 'QUEUE_OVERLOAD',
        severity: queue.depth >= thresholds.queueDepth * 2 ? 'CRITICAL' : 'WARNING',
        title: `Queue depth at ${queue.depth} jobs`,
        details: `Waiting ${queue.waiting} and delayed ${queue.delayed} jobs exceed the threshold of ${thresholds.queueDepth}.`,
        value: queue.depth,
        threshold: thresholds.queueDepth,
      });
    }

    const worker = input.snapshot?.worker;
    const pendingJobs = queue ? queue.waiting + queue.active : 0;
    const queueBusy = Boolean(queue?.available && pendingJobs > 0);
    const heartbeatStale =
      worker !== undefined &&
      (!worker.available || (worker.heartbeatAgeMs !== null && worker.heartbeatAgeMs > thresholds.workerHeartbeatAgeMs));
    if (input.snapshot && queueBusy && heartbeatStale && worker) {
      candidates.push({
        type: 'WORKER_FAILURE',
        severity: 'CRITICAL',
        title: 'Worker heartbeat is stale while work is queued',
        details: worker.available
          ? `Last heartbeat was ${worker.heartbeatAgeMs} ms ago with ${pendingJobs} jobs pending or running.`
          : `${pendingJobs} jobs are waiting but no worker heartbeat was found.`,
        value: worker.heartbeatAgeMs,
        threshold: thresholds.workerHeartbeatAgeMs,
      });
    }

    if (aiCostUsd !== null && aiCostUsd >= thresholds.aiCostSpikeUsd) {
      candidates.push({
        type: 'AI_COST_SPIKE',
        severity: aiCostUsd >= thresholds.aiCostSpikeUsd * 2 ? 'CRITICAL' : 'WARNING',
        title: `AI spend spike: $${round2(aiCostUsd)} in the last hour`,
        details: `AI usage cost in the last hour reached $${round2(aiCostUsd)} (threshold $${thresholds.aiCostSpikeUsd}).`,
        value: round2(aiCostUsd),
        threshold: thresholds.aiCostSpikeUsd,
      });
    }

    return candidates;
  }

  private async computeAiCostLastHour(): Promise<number | null> {
    if (mongoose.connection.readyState !== 1) return null;
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const rows = await AIUsageModel.aggregate<{ total: number }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: null, total: { $sum: '$costEstimate' } } },
    ]);
    const total = rows[0]?.total;
    return typeof total === 'number' ? round2(total) : 0;
  }

  private async upsertAlert(
    candidate: AlertCandidate,
    context: { workspaceId?: string; scanId?: string },
  ): Promise<'created' | 'updated'> {
    const filter: Record<string, unknown> = {
      type: candidate.type,
      status: 'OPEN',
      workspaceId: context.workspaceId ? new Types.ObjectId(context.workspaceId) : { $exists: false },
    };
    const existing = await ProductionAlertModel.findOne(filter);
    if (existing) {
      existing.details = candidate.details;
      existing.value = candidate.value;
      existing.threshold = candidate.threshold;
      if (candidate.severity === 'CRITICAL') existing.severity = 'CRITICAL';
      if (context.scanId) existing.scanId = new Types.ObjectId(context.scanId);
      await existing.save();
      return 'updated';
    }

    await ProductionAlertModel.create({
      type: candidate.type,
      severity: candidate.severity,
      status: 'OPEN',
      title: candidate.title,
      details: candidate.details,
      value: candidate.value,
      threshold: candidate.threshold,
      ...(context.workspaceId ? { workspaceId: new Types.ObjectId(context.workspaceId) } : {}),
      ...(context.scanId ? { scanId: new Types.ObjectId(context.scanId) } : {}),
    });

    await createAuditLog({
      action: 'PRODUCTION_ALERT_TRIGGERED',
      resource: 'ProductionAlert',
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
      metadata: {
        type: candidate.type,
        severity: candidate.severity,
        value: candidate.value,
        threshold: candidate.threshold,
      },
    });

    return 'created';
  }

  async evaluate(input: AlertEvaluationInput): Promise<AlertEvaluationResult> {
    const aiCostUsd = input.aiCostLastHourUsd !== undefined
      ? input.aiCostLastHourUsd
      : await this.computeAiCostLastHour();
    const candidates = this.buildCandidates(input, aiCostUsd ?? null);
    const created: ProductionAlertType[] = [];
    const updated: ProductionAlertType[] = [];
    for (const candidate of candidates) {
      const outcome = await this.upsertAlert(candidate, {
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.scanId ? { scanId: input.scanId } : {}),
      });
      if (outcome === 'created') created.push(candidate.type);
      else updated.push(candidate.type);
    }
    return { created, updated };
  }

  async listAlerts(filters: ListAlertFilters = {}): Promise<ProductionAlertDTO[]> {
    const query: Record<string, unknown> = {};
    if (filters.status && (filters.status === 'OPEN' || filters.status === 'ACKNOWLEDGED')) {
      query.status = filters.status;
    }
    if (filters.type && (PRODUCTION_ALERT_TYPES as readonly string[]).includes(filters.type)) {
      query.type = filters.type;
    }
    if (filters.workspaceId && Types.ObjectId.isValid(filters.workspaceId)) {
      query.workspaceId = new Types.ObjectId(filters.workspaceId);
    }
    const limit = Number(filters.limit);
    const effectiveLimit = Number.isFinite(limit) && limit > 0 ? Math.min(200, Math.round(limit)) : 50;
    const alerts = await ProductionAlertModel.find(query)
      .sort({ createdAt: -1 })
      .limit(effectiveLimit)
      .lean();
    return alerts.map((alert) => toProductionAlertDTO(alert));
  }

  async acknowledgeAlert(alertId: string, actorUserId?: string): Promise<ProductionAlertDTO> {
    if (!Types.ObjectId.isValid(alertId)) throw new Error('INVALID_REQUEST');
    const alert = await ProductionAlertModel.findById(alertId);
    if (!alert) throw new Error('PRODUCTION_ALERT_NOT_FOUND');
    if (alert.status !== 'ACKNOWLEDGED') {
      alert.status = 'ACKNOWLEDGED';
      alert.acknowledgedAt = new Date();
      if (actorUserId) alert.acknowledgedBy = new Types.ObjectId(actorUserId);
      await alert.save();
      await createAuditLog({
        action: 'PRODUCTION_ALERT_ACKNOWLEDGED',
        ...(actorUserId ? { userId: actorUserId } : {}),
        resource: 'ProductionAlert',
        resourceId: alert._id.toString(),
        ...(alert.workspaceId ? { workspaceId: alert.workspaceId.toString() } : {}),
        metadata: { type: alert.type, severity: alert.severity },
      });
    }
    return toProductionAlertDTO(alert);
  }
}

export const productionAlertService = ProductionAlertService.getInstance();
export default productionAlertService;
