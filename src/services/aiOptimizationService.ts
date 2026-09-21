import { Types } from 'mongoose';
import { AIProviderFactory } from './ai/AIProviderFactory.js';
import { AISecurityService } from './ai/aiSecurityService.js';
import { AIUsageService } from './aiUsageService.js';
import { createAuditLog } from './auditService.js';
import { AIGovernanceGate } from './aiGovernanceGate.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { ExecutionAnalyticsModel } from '../models/ExecutionAnalyticsModel.js';
import type { WorkflowOptimizationInput } from './ai/AIProvider.js';

export interface OptimizationIssue {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  affectedNodeId?: string;
}

export interface OptimizationRecommendation {
  title: string;
  description: string;
  impact: string;
  action?: string;
}

export interface OptimizationResult {
  issues: OptimizationIssue[];
  recommendations: OptimizationRecommendation[];
  estimatedImprovement: string | number;
}

export class AIOptimizationService {
  private static instance: AIOptimizationService;

  public static getInstance(): AIOptimizationService {
    if (!AIOptimizationService.instance) {
      AIOptimizationService.instance = new AIOptimizationService();
    }
    return AIOptimizationService.instance;
  }

  async suggestOptimization(
    workflowId: Types.ObjectId | string,
    userId: Types.ObjectId | string
  ): Promise<OptimizationResult> {
    // 1. Get workflow data
    const workflow = await WorkflowModel.findById(workflowId);
    if (!workflow) {
      throw new Error('WORKFLOW_NOT_FOUND: Workflow not found');
    }

    // 2. Query execution metrics from existing analytics
    const analytics = await ExecutionAnalyticsModel.find({
      workflowId: workflow._id,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    let averageDuration: number | undefined;
    let failureRate: number | undefined;
    let retryCounts: number | undefined;

    if (analytics.length > 0) {
      const totalDuration = analytics.reduce((acc, a) => acc + (a.durationMs || 0), 0);
      averageDuration = Math.round(totalDuration / analytics.length);
      const failedCount = analytics.filter((a) => a.status === 'FAILED').length;
      failureRate = Math.round((failedCount / analytics.length) * 100) / 100;
      retryCounts = analytics.reduce((acc, a) => acc + (a.retryCount || 0), 0);
    }

    const definition = workflow.draftDefinition || {};
    const sanitizedDefinition = AISecurityService.sanitizeMetadata(
      typeof definition === 'object' && definition !== null
        ? (definition as unknown as Record<string, unknown>)
        : {}
    );

    const nodes = (sanitizedDefinition as any).nodes || [];
    const edges = (sanitizedDefinition as any).edges || [];

    const metrics: WorkflowOptimizationInput['metrics'] = {};
    if (averageDuration !== undefined) metrics.averageDuration = averageDuration;
    if (failureRate !== undefined) metrics.failureRate = failureRate;
    if (retryCounts !== undefined) metrics.retryCounts = retryCounts;

    // 3. Security: Prepare sanitized workflow data for AI
    const sanitizedWorkflowData: WorkflowOptimizationInput = {
      workflowId: workflow.id.toString(),
      workflowName: workflow.name,
      definition: {
        nodes,
        edges,
      },
      ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
    };

    // 4. Resolve Provider for workspace
    const workspaceId = workflow.workspaceId || workflow.ownerId;
    const { provider, model, providerName } = await AIProviderFactory.getProviderForWorkspace(
      workspaceId,
      'optimization'
    );

    const governance = await AIGovernanceGate.getInstance().authorize({
      workspaceId: workspaceId.toString(),
      userId: userId.toString(),
      feature: 'AI_OPTIMIZATION',
      model,
    });
    if (governance.decision === 'DENY') throw new Error('AI_GOVERNANCE_DENIED');
    if (governance.decision === 'REQUIRE_APPROVAL') throw new Error('AI_GOVERNANCE_APPROVAL_REQUIRED');

    // 5. AI optimization
    const result = await provider.suggestOptimization(sanitizedWorkflowData);

    // 6. Record Usage
    if (workspaceId) {
      await AIUsageService.recordUsage({
        workspaceId,
        userId,
        feature: 'optimization',
        model,
      });
    }

    // 7. Audit Log
    await createAuditLog({
      action: 'AI_OPTIMIZATION_CREATED',
      userId,
      workspaceId: workspaceId || undefined,
      metadata: {
        workflowId: workflow.id.toString(),
        provider: providerName,
        model,
        issuesCount: result.issues.length,
        recommendationsCount: result.recommendations.length,
      },
    });

    return result;
  }
}

export default AIOptimizationService.getInstance();
