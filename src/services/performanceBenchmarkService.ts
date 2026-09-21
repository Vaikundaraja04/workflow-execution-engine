import { Types } from 'mongoose';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { AIUsageModel } from '../models/AIUsageModel.js';
import { AgentRunModel } from '../models/AgentRunModel.js';
import { AgentMarketplaceModel } from '../models/AgentMarketplaceModel.js';
import { AIGovernancePolicyService } from './aiGovernancePolicyService.js';
import { createAuditLog } from './auditService.js';
import { AISecurityService } from './ai/aiSecurityService.js';

export type BenchmarkVerdict = 'PASS' | 'WARN' | 'FAIL';

export interface BenchmarkOperationResult {
  id: string;
  label: string;
  iterations: number;
  medianMs: number;
  worstMs: number;
  thresholdMs: number;
  verdict: BenchmarkVerdict;
}

export interface PerformanceBenchmarkReport {
  generatedAt: string;
  workspaceId: string;
  operations: BenchmarkOperationResult[];
  score: number;
  verdict: BenchmarkVerdict;
  slowest: { id: string; medianMs: number } | null;
}

const ITERATIONS = 5;

function toObjectId(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw new Error('INVALID_REQUEST');
  return new Types.ObjectId(value);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  }
  return sorted[middle] ?? 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
export class PerformanceBenchmarkService {
  private static instance: PerformanceBenchmarkService;
  public static getInstance(): PerformanceBenchmarkService {
    if (!PerformanceBenchmarkService.instance) PerformanceBenchmarkService.instance = new PerformanceBenchmarkService();
    return PerformanceBenchmarkService.instance;
  }

  private operations(wsId: Types.ObjectId): Array<{
    id: string;
    label: string;
    thresholdMs: number;
    run: () => Promise<unknown>;
  }> {
    return [
      {
        id: 'workflow.list',
        label: 'Workflow listing (50 docs)',
        thresholdMs: 150,
        run: () => WorkflowModel.find({ workspaceId: wsId }).limit(50).lean(),
      },
      {
        id: 'execution.list',
        label: 'Execution history (50 docs, newest first)',
        thresholdMs: 200,
        run: () => WorkflowExecutionModel.find({ workspaceId: wsId }).sort({ createdAt: -1 }).limit(50).lean(),
      },
      {
        id: 'audit.query',
        label: 'Audit log query (50 docs)',
        thresholdMs: 200,
        run: () => AuditLogModel.find({ workspaceId: wsId }).sort({ createdAt: -1 }).limit(50).lean(),
      },
      {
        id: 'aiUsage.aggregate',
        label: 'AI usage aggregation by feature',
        thresholdMs: 250,
        run: () => AIUsageModel.aggregate([
          { $match: { workspaceId: wsId } },
          { $group: { _id: '$feature', tokens: { $sum: '$tokensUsed' }, cost: { $sum: '$costEstimate' } } },
        ]),
      },
      {
        id: 'marketplace.search',
        label: 'Marketplace search (20 listings)',
        thresholdMs: 200,
        run: () => AgentMarketplaceModel.find({ status: 'PUBLISHED', visibility: 'PUBLIC' }).limit(20).lean(),
      },
      {
        id: 'governance.evaluate',
        label: 'AI governance evaluation',
        thresholdMs: 250,
        run: () => AIGovernancePolicyService.getInstance().evaluateRequest({
          workspaceId: wsId.toString(),
          feature: 'AI_AGENT',
          dryRun: true,
        }),
      },
      {
        id: 'agentRun.stats',
        label: 'Agent run statistics',
        thresholdMs: 250,
        run: () => AgentRunModel.aggregate([
          { $match: { workspaceId: wsId } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
      },
    ];
  }
  async runBenchmark(workspaceId: string, actorUserId?: string): Promise<PerformanceBenchmarkReport> {
    const wsId = toObjectId(workspaceId);
    const operations: BenchmarkOperationResult[] = [];

    for (const operation of this.operations(wsId)) {
      const durations: number[] = [];
      let failed = false;
      for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
        const started = process.hrtime.bigint();
        try {
          await operation.run();
        } catch {
          failed = true;
        }
        durations.push(Number(process.hrtime.bigint() - started) / 1_000_000);
      }
      const medianMs = round1(median(durations));
      const worstMs = round1(Math.max(...durations));
      operations.push({
        id: operation.id,
        label: operation.label,
        iterations: ITERATIONS,
        medianMs,
        worstMs,
        thresholdMs: operation.thresholdMs,
        verdict: failed ? 'FAIL' : medianMs <= operation.thresholdMs ? 'PASS' : medianMs <= operation.thresholdMs * 2 ? 'WARN' : 'FAIL',
      });
    }

    const warnings = operations.filter((entry) => entry.verdict === 'WARN').length;
    const failures = operations.filter((entry) => entry.verdict === 'FAIL').length;
    const totalMs = operations.reduce((sum, entry) => sum + entry.medianMs, 0);
    const slowestEntry = [...operations].sort((left, right) => right.medianMs - left.medianMs)[0] ?? null;
    const verdict: BenchmarkVerdict = failures > 0 ? 'FAIL' : warnings > 0 ? 'WARN' : 'PASS';

    const report: PerformanceBenchmarkReport = {
      generatedAt: new Date().toISOString(),
      workspaceId,
      operations,
      score: Math.max(0, 100 - warnings * 10 - failures * 25),
      verdict,
      slowest: slowestEntry ? { id: slowestEntry.id, medianMs: slowestEntry.medianMs } : null,
    };

    await createAuditLog({
      action: 'PERFORMANCE_TEST_COMPLETED',
      ...(actorUserId ? { userId: actorUserId } : {}),
      resource: 'system',
      metadata: AISecurityService.sanitizeMetadata({
        verdict,
        warnings,
        failures,
        totalMedianMs: round1(totalMs),
      }),
    });

    return report;
  }
}

export const performanceBenchmarkService = PerformanceBenchmarkService.getInstance();
export default performanceBenchmarkService;