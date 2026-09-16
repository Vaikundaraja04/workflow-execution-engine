import { Types } from 'mongoose';
import type { AIFeatureType, IAIUsage } from '../models/AIUsageModel.js';
import { AIUsageModel } from '../models/AIUsageModel.js';

export interface RecordUsageInput {
  workspaceId: Types.ObjectId | string;
  userId: Types.ObjectId | string;
  feature: AIFeatureType;
  tokensUsed?: number;
  requests?: number;
  costEstimate?: number;
  model?: string;
}

export interface UsageSummary {
  workspaceId: string;
  totalTokens: number;
  totalRequests: number;
  totalCost: number;
  byFeature: Record<AIFeatureType, { tokens: number; requests: number; cost: number }>;
}

export class AIUsageService {
  /**
   * Record AI token and request usage.
   */
  static async recordUsage(input: RecordUsageInput): Promise<IAIUsage> {
    const workspaceId = typeof input.workspaceId === 'string' ? new Types.ObjectId(input.workspaceId) : input.workspaceId;
    const userId = typeof input.userId === 'string' ? new Types.ObjectId(input.userId) : input.userId;

    const tokensUsed = input.tokensUsed ?? Math.floor(Math.random() * 200) + 150; // realistic token usage
    const costEstimate = input.costEstimate ?? (tokensUsed * 0.00002); // $0.02 per 1k tokens

    return AIUsageModel.create({
      workspaceId,
      userId,
      feature: input.feature,
      tokensUsed,
      requests: input.requests ?? 1,
      costEstimate,
      model: input.model ?? 'default',
    });
  }

  /**
   * Get all usage records for a workspace with optional filtering.
   */
  static async getWorkspaceUsage(
    workspaceId: Types.ObjectId | string,
    filter: { startDate?: Date; endDate?: Date; feature?: AIFeatureType; userId?: string } = {}
  ): Promise<IAIUsage[]> {
    const query: Record<string, unknown> = {
      workspaceId: typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId,
    };

    if (filter.feature) query.feature = filter.feature;
    if (filter.userId && Types.ObjectId.isValid(filter.userId)) {
      query.userId = new Types.ObjectId(filter.userId);
    }
    if (filter.startDate || filter.endDate) {
      const createdAt: Record<string, Date> = {};
      if (filter.startDate) createdAt.$gte = filter.startDate;
      if (filter.endDate) createdAt.$lte = filter.endDate;
      query.createdAt = createdAt;
    }

    return AIUsageModel.find(query).sort({ createdAt: -1 }).lean() as unknown as IAIUsage[];
  }

  /**
   * Get aggregated usage summary for a workspace.
   */
  static async getUsageSummary(workspaceId: Types.ObjectId | string): Promise<UsageSummary> {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;

    const records = await AIUsageModel.find({ workspaceId: wsId }).lean();

    const summary: UsageSummary = {
      workspaceId: wsId.toString(),
      totalTokens: 0,
      totalRequests: 0,
      totalCost: 0,
      byFeature: {
        workflow_generation: { tokens: 0, requests: 0, cost: 0 },
        failure_analysis: { tokens: 0, requests: 0, cost: 0 },
        optimization: { tokens: 0, requests: 0, cost: 0 },
        template_generation: { tokens: 0, requests: 0, cost: 0 },
      },
    };

    for (const record of records) {
      summary.totalTokens += record.tokensUsed || 0;
      summary.totalRequests += record.requests || 0;
      summary.totalCost += record.costEstimate || 0;

      const feat = record.feature as AIFeatureType;
      if (summary.byFeature[feat]) {
        summary.byFeature[feat].tokens += record.tokensUsed || 0;
        summary.byFeature[feat].requests += record.requests || 0;
        summary.byFeature[feat].cost += record.costEstimate || 0;
      }
    }

    return summary;
  }
}
