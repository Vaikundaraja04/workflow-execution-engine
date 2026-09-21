import { Types } from 'mongoose';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { AIUsageModel } from '../models/AIUsageModel.js';
import { AgentRunModel } from '../models/AgentRunModel.js';
import { AgentReviewModel } from '../models/AgentReviewModel.js';
import { InstalledAgentModel } from '../models/InstalledAgentModel.js';
import { ObservabilityService } from './observabilityService.js';

export interface EnterpriseMetricsReport {
  generatedAt: string;
  workspaceId: string;
  windowHours: number;
  apiLatency: {
    executionP95Ms: number;
    throughputRpm: number;
    errorRatePercent: number;
  };
  workflowThroughput: {
    executions: number;
    succeeded: number;
    failed: number;
    successRatePercent: number;
    executionsPerHour: number;
  };
  aiCost: {
    requests: number;
    tokensUsed: number;
    costEstimate: number;
    byFeature: Array<{ feature: string; requests: number; tokensUsed: number; costEstimate: number }>;
  };
  agentExecution: {
    totalRuns: number;
    byStatus: Record<string, number>;
    failureRatePercent: number;
    toolCalls: number;
    failedToolCalls: number;
    toolErrorRatePercent: number;
  };
  marketplaceActivity: {
    installsInWindow: number;
    activeInstalls: number;
    reviewsInWindow: number;
    averageRating: number | null;
    executionsInWindow: number;
  };
}

export const MIN_METRICS_WINDOW_HOURS = 1;
export const MAX_METRICS_WINDOW_HOURS = 720;
const DEFAULT_METRICS_WINDOW_HOURS = 24;

function clampWindowHours(windowHours: number): number {
  if (!Number.isFinite(windowHours)) return DEFAULT_METRICS_WINDOW_HOURS;
  return Math.min(MAX_METRICS_WINDOW_HOURS, Math.max(MIN_METRICS_WINDOW_HOURS, Math.round(windowHours)));
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface StatusCountRow {
  _id: string;
  count: number;
}

interface AiUsageRow {
  _id: string;
  requests: number;
  tokensUsed: number;
  costEstimate: number;
}
export class EnterpriseMetricsService {
  private static instance: EnterpriseMetricsService;
  public static getInstance(): EnterpriseMetricsService {
    if (!EnterpriseMetricsService.instance) EnterpriseMetricsService.instance = new EnterpriseMetricsService();
    return EnterpriseMetricsService.instance;
  }

  private async getWorkflowStatusCounts(wsId: Types.ObjectId, windowStart: Date): Promise<StatusCountRow[]> {
    return WorkflowExecutionModel.aggregate<StatusCountRow>([
      { $match: { workspaceId: wsId, createdAt: { $gte: windowStart } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
  }

  private async getAgentRunStatusCounts(wsId: Types.ObjectId, windowStart: Date): Promise<StatusCountRow[]> {
    return AgentRunModel.aggregate<StatusCountRow>([
      { $match: { workspaceId: wsId, createdAt: { $gte: windowStart } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
  }

  private async getToolCallStats(wsId: Types.ObjectId, windowStart: Date): Promise<{ total: number; failed: number }> {
    const rows = await AgentRunModel.aggregate<{ total: number; failed: number }>([
      { $match: { workspaceId: wsId, createdAt: { $gte: windowStart } } },
      { $unwind: '$toolCalls' },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          failed: { $sum: { $cond: [{ $in: ['$toolCalls.status', ['FAILED', 'DENIED']] }, 1, 0] } },
        },
      },
    ]);
    return rows[0] ?? { total: 0, failed: 0 };
  }

  private async getAiUsageRows(wsId: Types.ObjectId, windowStart: Date): Promise<AiUsageRow[]> {
    return AIUsageModel.aggregate<AiUsageRow>([
      { $match: { workspaceId: wsId, createdAt: { $gte: windowStart } } },
      {
        $group: {
          _id: '$feature',
          requests: { $sum: '$requests' },
          tokensUsed: { $sum: '$tokensUsed' },
          costEstimate: { $sum: '$costEstimate' },
        },
      },
      { $sort: { costEstimate: -1 } },
    ]);
  }

  private async getAverageRating(wsId: Types.ObjectId, windowStart: Date): Promise<number | null> {
    const rows = await AgentReviewModel.aggregate<{ average: number }>([
      { $match: { workspaceId: wsId, createdAt: { $gte: windowStart } } },
      { $group: { _id: null, average: { $avg: '$rating' } } },
    ]);
    const average = rows[0]?.average;
    return typeof average === 'number' ? round2(average) : null;
  }
  async getEnterpriseMetrics(workspaceId: string, windowHours?: number): Promise<EnterpriseMetricsReport> {
    if (!Types.ObjectId.isValid(workspaceId)) throw new Error('INVALID_REQUEST');
    const wsId = new Types.ObjectId(workspaceId);
    const window = clampWindowHours(windowHours ?? DEFAULT_METRICS_WINDOW_HOURS);
    const windowStart = new Date(Date.now() - window * 60 * 60 * 1000);

    const [
      systemMetrics,
      workflowRows,
      aiUsageRows,
      agentRunRows,
      toolStats,
      installsInWindow,
      activeInstalls,
      reviewsInWindow,
      executionsInWindow,
      averageRating,
    ] = await Promise.all([
      ObservabilityService.getSystemMetrics(),
      this.getWorkflowStatusCounts(wsId, windowStart),
      this.getAiUsageRows(wsId, windowStart),
      this.getAgentRunStatusCounts(wsId, windowStart),
      this.getToolCallStats(wsId, windowStart),
      InstalledAgentModel.countDocuments({ workspaceId: wsId, createdAt: { $gte: windowStart } }),
      InstalledAgentModel.countDocuments({ workspaceId: wsId, status: 'ACTIVE' }),
      AgentReviewModel.countDocuments({ workspaceId: wsId, createdAt: { $gte: windowStart } }),
      AgentRunModel.countDocuments({ workspaceId: wsId, createdAt: { $gte: windowStart } }),
      this.getAverageRating(wsId, windowStart),
    ]);

    const workflowCounts = new Map(workflowRows.map((row) => [row._id, row.count]));
    const executions = workflowRows.reduce((sum, row) => sum + row.count, 0);
    const succeeded = workflowCounts.get('SUCCEEDED') ?? 0;
    const failed = workflowCounts.get('FAILED') ?? 0;

    const byStatus: Record<string, number> = {};
    let totalRuns = 0;
    for (const row of agentRunRows) {
      byStatus[row._id] = row.count;
      totalRuns += row.count;
    }

    const byFeature = aiUsageRows.map((row) => ({
      feature: row._id,
      requests: row.requests,
      tokensUsed: row.tokensUsed,
      costEstimate: round2(row.costEstimate),
    }));

    return {
      generatedAt: new Date().toISOString(),
      workspaceId,
      windowHours: window,
      apiLatency: {
        executionP95Ms: systemMetrics.p95ApiLatencyMs,
        throughputRpm: systemMetrics.apiThroughputRpm,
        errorRatePercent: systemMetrics.apiErrorRatePercent,
      },
      workflowThroughput: {
        executions,
        succeeded,
        failed,
        successRatePercent: percent(succeeded, succeeded + failed),
        executionsPerHour: round2(executions / window),
      },
      aiCost: {
        requests: byFeature.reduce((sum, item) => sum + item.requests, 0),
        tokensUsed: byFeature.reduce((sum, item) => sum + item.tokensUsed, 0),
        costEstimate: round2(byFeature.reduce((sum, item) => sum + item.costEstimate, 0)),
        byFeature,
      },
      agentExecution: {
        totalRuns,
        byStatus,
        failureRatePercent: percent(byStatus.FAILED ?? 0, totalRuns),
        toolCalls: toolStats.total,
        failedToolCalls: toolStats.failed,
        toolErrorRatePercent: percent(toolStats.failed, toolStats.total),
      },
      marketplaceActivity: {
        installsInWindow,
        activeInstalls,
        reviewsInWindow,
        averageRating,
        executionsInWindow,
      },
    };
  }
}

export const enterpriseMetricsService = EnterpriseMetricsService.getInstance();
export default enterpriseMetricsService;
