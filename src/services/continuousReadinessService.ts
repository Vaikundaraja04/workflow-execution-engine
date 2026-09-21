import { Types } from 'mongoose';
import { ReadinessScanModel } from '../models/ReadinessScanModel.js';
import type { IReadinessScanDimensions, IReadinessScanMetrics } from '../models/ReadinessScanModel.js';
import { releaseReadinessService } from './releaseReadinessService.js';
import { observabilityCollectorService } from './observabilityCollectorService.js';
import { productionAlertService } from './productionAlertService.js';
import { createAuditLog } from './auditService.js';
import { logger } from '../observability/logger.js';

export type ReadinessScanVerdict = 'READY' | 'NEEDS_ATTENTION' | 'NOT_READY';

export interface ReadinessScanAlertSummary {
  created: string[];
  updated: string[];
}

export interface ReadinessScanDTO {
  id: string;
  workspaceId: string | null;
  score: number;
  previousScore: number | null;
  delta: number | null;
  verdict: ReadinessScanVerdict;
  dimensions: IReadinessScanDimensions;
  metrics: IReadinessScanMetrics;
  regressions: string[];
  createdAt: string;
  alerts: ReadinessScanAlertSummary | null;
}

export interface RunScanOptions {
  workspaceId?: string;
  actorUserId?: string;
}

export interface ScanHistoryOptions {
  workspaceId?: string;
  limit?: number;
}

export const DEFAULT_SCAN_HISTORY_LIMIT = 50;
export const MAX_SCAN_HISTORY_LIMIT = 200;
export const MIN_READINESS_SCAN_INTERVAL_MS = 10_000;

interface ScanLike {
  _id: Types.ObjectId;
  workspaceId?: Types.ObjectId | null;
  score: number;
  previousScore?: number | null;
  delta?: number | null;
  verdict: ReadinessScanVerdict;
  dimensions: IReadinessScanDimensions;
  metrics: IReadinessScanMetrics;
  regressions?: string[];
  createdAt: Date;
}

function toScanDTO(scan: ScanLike, alerts: ReadinessScanAlertSummary | null = null): ReadinessScanDTO {
  return {
    id: scan._id.toString(),
    workspaceId: scan.workspaceId ? scan.workspaceId.toString() : null,
    score: scan.score,
    previousScore: scan.previousScore ?? null,
    delta: scan.delta ?? null,
    verdict: scan.verdict,
    dimensions: scan.dimensions,
    metrics: scan.metrics,
    regressions: scan.regressions ?? [],
    createdAt: scan.createdAt.toISOString(),
    alerts,
  };
}

function detectRegressions(previous: ScanLike | null, current: IReadinessScanDimensions): string[] {
  if (!previous) return [];
  const prior = previous.dimensions;
  const regressions: string[] = [];
  if (current.security.failures > prior.security.failures) {
    regressions.push(`security failures ${prior.security.failures} -> ${current.security.failures}`);
  } else if (current.security.warnings > prior.security.warnings) {
    regressions.push(`security warnings ${prior.security.warnings} -> ${current.security.warnings}`);
  }
  if (current.database.score < prior.database.score) {
    regressions.push(`database score ${prior.database.score} -> ${current.database.score}`);
  }
  if (current.deployment.score < prior.deployment.score) {
    regressions.push(`deployment score ${prior.deployment.score} -> ${current.deployment.score}`);
  }
  if (current.queueWorker.score < prior.queueWorker.score) {
    regressions.push(`queue worker score ${prior.queueWorker.score} -> ${current.queueWorker.score}`);
  }
  return regressions;
}

export class ContinuousReadinessService {
  private static instance: ContinuousReadinessService;
  public static getInstance(): ContinuousReadinessService {
    if (!ContinuousReadinessService.instance) {
      ContinuousReadinessService.instance = new ContinuousReadinessService();
    }
    return ContinuousReadinessService.instance;
  }

  private timer: NodeJS.Timeout | null = null;
  private timerIntervalMs: number | null = null;

  private scopeFilter(workspaceId?: string): Record<string, unknown> {
    return workspaceId
      ? { workspaceId: new Types.ObjectId(workspaceId) }
      : { workspaceId: { $exists: false } };
  }

  async runScan(options: RunScanOptions = {}): Promise<ReadinessScanDTO> {
    const report = await releaseReadinessService.getReadinessReport(options.actorUserId);
    const snapshot = await observabilityCollectorService.collectSnapshot();
    const previous = await ReadinessScanModel.findOne(this.scopeFilter(options.workspaceId))
      .sort({ createdAt: -1 })
      .lean();
    const previousScore = previous ? previous.score : null;
    const delta = previousScore === null ? null : report.score - previousScore;
    const regressions = detectRegressions(previous, report.dimensions);
    const metrics: IReadinessScanMetrics = {
      redisStatus: snapshot.redis.status,
      queueDepth: snapshot.queue.depth,
      workerAvailable: snapshot.worker.available,
      workerUtilizationPercent: snapshot.worker.utilizationPercent,
      apiP95Ms: snapshot.api.p95Ms,
      executionsLastHour: snapshot.executions.lastHour,
      executionErrorRatePercent: snapshot.executions.errorRatePercent,
    };

    const scan = await ReadinessScanModel.create({
      ...(options.workspaceId ? { workspaceId: new Types.ObjectId(options.workspaceId) } : {}),
      score: report.score,
      previousScore,
      delta,
      verdict: report.verdict,
      dimensions: report.dimensions,
      metrics,
      regressions,
    });

    const alerts = await productionAlertService.evaluate({
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      scanId: scan._id.toString(),
      score: report.score,
      delta,
      securityFailures: report.dimensions.security.failures,
      previousSecurityFailures: previous ? previous.dimensions.security.failures : null,
      snapshot,
    });

    await createAuditLog({
      action: 'READINESS_SCAN_COMPLETED',
      ...(options.actorUserId ? { userId: options.actorUserId } : {}),
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      resource: 'system',
      metadata: {
        scanId: scan._id.toString(),
        score: report.score,
        verdict: report.verdict,
        delta,
        regressions,
        alertsCreated: alerts.created,
        alertsUpdated: alerts.updated,
      },
    });

    return toScanDTO(scan, alerts);
  }
  async getScanHistory(options: ScanHistoryOptions = {}): Promise<ReadinessScanDTO[]> {
    const requested = Number(options.limit);
    const limit = Number.isFinite(requested) && requested > 0
      ? Math.min(MAX_SCAN_HISTORY_LIMIT, Math.round(requested))
      : DEFAULT_SCAN_HISTORY_LIMIT;
    const scans = await ReadinessScanModel.find(this.scopeFilter(options.workspaceId))
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return scans.map((scan) => toScanDTO(scan));
  }

  startScheduler(): { started: boolean; intervalMs: number | null } {
    if (this.timer) return { started: false, intervalMs: this.timerIntervalMs };
    const raw = Number(process.env.READINESS_SCAN_INTERVAL_MS);
    if (!Number.isFinite(raw) || raw < MIN_READINESS_SCAN_INTERVAL_MS) {
      return { started: false, intervalMs: null };
    }
    const intervalMs = Math.floor(raw);
    this.timer = setInterval(() => {
      void this.runScheduledScan();
    }, intervalMs);
    this.timer.unref();
    this.timerIntervalMs = intervalMs;
    logger.info('readiness_scan_scheduler_started', { intervalMs });
    return { started: true, intervalMs };
  }

  stopScheduler(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.timerIntervalMs = null;
  }

  isSchedulerRunning(): boolean {
    return this.timer !== null;
  }

  private async runScheduledScan(): Promise<void> {
    try {
      const scan = await this.runScan({});
      logger.info('readiness_scan_scheduled', {
        scanId: scan.id,
        score: scan.score,
        verdict: scan.verdict,
        alertsCreated: scan.alerts?.created ?? [],
      });
    } catch (error) {
      logger.warn('readiness_scan_scheduled_failed', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const continuousReadinessService = ContinuousReadinessService.getInstance();
export default continuousReadinessService;