import { Types } from 'mongoose';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { AIProviderFactory } from './ai/AIProviderFactory.js';
import { AIGovernanceGate } from './aiGovernanceGate.js';
import { ObservabilityService } from './observabilityService.js';
import { EnterpriseAnalyticsService } from './enterpriseAnalyticsService.js';
import { AuditIntelligenceService } from './auditIntelligenceService.js';
import type {
  AIOperationsFailureExplanation,
  AIOperationsSystemSummary,
  AIOperationsOptimizationSuggestion,
} from '../types/operations.types.js';

export class AIOperationsAssistantService {
  /**
   * Explain a workflow execution failure using AI root-cause diagnostics
   */
  public static async explainWorkflowFailure(
    executionId: string,
    workspaceId: string,
    userId?: string
  ): Promise<AIOperationsFailureExplanation> {
    const wsId = new Types.ObjectId(workspaceId);

    const execution = await WorkflowExecutionModel.findOne({
      _id: Types.ObjectId.isValid(executionId) ? new Types.ObjectId(executionId) : executionId,
      workspaceId: wsId,
    }).lean();

    if (!execution) {
      throw new Error('EXECUTION_NOT_FOUND');
    }

    const workflow = await WorkflowModel.findOne({
      _id: execution.workflowId,
      workspaceId: wsId,
    }).lean();

    const workflowName = workflow ? workflow.name : 'Unknown Workflow';

    const { provider } = await AIProviderFactory.getProviderForWorkspace(
      workspaceId,
      'failureAnalysis'
    );

    const governance = await AIGovernanceGate.getInstance().authorize({
      workspaceId: workspaceId.toString(),
      feature: 'AI_ANALYSIS',
      ...(userId ? { userId: userId.toString() } : {}),
    });
    if (governance.decision === 'DENY') throw new Error('AI_GOVERNANCE_DENIED');
    if (governance.decision === 'REQUIRE_APPROVAL') throw new Error('AI_GOVERNANCE_APPROVAL_REQUIRED');

    const analysisResult = await provider.analyzeExecution({
      executionId: execution._id.toString(),
      status: execution.status,
      error: execution.error ? execution.error.message : null,
      errors: execution.error ? [{ message: execution.error.message }] : [],
      stepStatuses: (execution as any).stepStatuses,
      duration: execution.finishedAt && execution.startedAt
        ? new Date(execution.finishedAt).getTime() - new Date(execution.startedAt).getTime()
        : 0,
      retryAttempts: (execution as any).retryCount || 0,
      workflowDefinition: workflow?.draftDefinition,
    });

    const failingNode = analysisResult.affectedNode
      ? {
          nodeId: analysisResult.affectedNode,
          nodeType: 'action',
          error: (execution.error ? execution.error.message : undefined) || 'Execution step returned error status',
        }
      : undefined;

    const suggestedFixes = [
      analysisResult.suggestedFix,
      'Check webhook payload schema and input parameter bindings.',
      'Enable automated retry policy with exponential backoff on intermittent step.',
    ].filter(Boolean);

    if (userId && Types.ObjectId.isValid(userId)) {
      await AuditLogModel.create({
        workspaceId: wsId,
        userId: new Types.ObjectId(userId),
        action: 'AI_OPERATIONS_ASSISTANT_REQUESTED',
        resource: 'WorkflowExecution',
        resourceId: executionId,
        metadata: { query: 'explain_failure', workflowName },
      });
    }

    return {
      executionId: execution._id.toString(),
      workflowName,
      failureSummary: analysisResult.summary,
      rootCause: analysisResult.rootCause,
      failingNode,
      suggestedFixes,
      confidenceScore: Math.round(analysisResult.confidence * 100),
    };
  }

  /**
   * Generate an executive summary of workspace system operations & health
   */
  public static async summarizeSystemHealth(
    workspaceId: string,
    userId?: string
  ): Promise<AIOperationsSystemSummary> {
    const wsId = new Types.ObjectId(workspaceId);

    const [health, metrics, overview, security] = await Promise.all([
      ObservabilityService.getSystemHealth(),
      ObservabilityService.getSystemMetrics(),
      EnterpriseAnalyticsService.getOverviewAnalytics(workspaceId, '7d'),
      AuditIntelligenceService.getSecurityIntelligence(workspaceId),
    ]);

    let healthGrade: 'A' | 'B' | 'C' | 'D' | 'F' = 'A';
    const keyObservations: string[] = [];
    const immediateActions: string[] = [];

    if (health.status === 'UNHEALTHY' || metrics.apiErrorRatePercent > 10) {
      healthGrade = 'F';
      keyObservations.push(`High API error rate: ${metrics.apiErrorRatePercent}%`);
      immediateActions.push('Investigate failing execution steps and database connection pool saturation.');
    } else if (health.status === 'DEGRADED' || metrics.apiErrorRatePercent > 5) {
      healthGrade = 'C';
      keyObservations.push(`Elevated execution failure rate of ${metrics.apiErrorRatePercent}% detected.`);
      immediateActions.push('Review recent deployment changes and worker queue capacity.');
    } else if (security.threatLevel === 'HIGH' || security.threatLevel === 'CRITICAL') {
      healthGrade = 'B';
      keyObservations.push(`Security threat level is currently ${security.threatLevel}.`);
      immediateActions.push('Review flagged suspicious activity in Security Operations.');
    } else {
      healthGrade = 'A';
      keyObservations.push(`System running smoothly with ${overview.successRate}% workflow success rate.`);
      keyObservations.push(`P95 execution latency is steady at ${overview.p95DurationMs}ms.`);
    }

    const scalingAdvice = metrics.workerUtilizationPercent > 80
      ? 'Worker utilization is above 80%. Recommend scaling worker pool by 2-4 instances.'
      : 'Cluster capacity is healthy. Current worker concurrency is optimal for current load.';

    const summary = `System is operating at Grade ${healthGrade}. Workflow throughput is ${metrics.apiThroughputRpm} RPM with a ${overview.successRate}% overall success rate across ${overview.totalExecutions} executions over the past 7 days.`;

    if (userId && Types.ObjectId.isValid(userId)) {
      await AuditLogModel.create({
        workspaceId: wsId,
        userId: new Types.ObjectId(userId),
        action: 'AI_OPERATIONS_ASSISTANT_REQUESTED',
        resource: 'SystemHealth',
        resourceId: workspaceId,
        metadata: { query: 'system_summary', healthGrade },
      });
    }

    return {
      workspaceId,
      summary,
      healthGrade,
      keyObservations,
      immediateActions: immediateActions.length > 0 ? immediateActions : ['Continue regular automated health and security checks.'],
      scalingAdvice,
    };
  }

  /**
   * Suggest workflow and operational optimizations
   */
  public static async suggestOptimizations(
    workspaceId: string
  ): Promise<AIOperationsOptimizationSuggestion[]> {
    const workflowsData = await EnterpriseAnalyticsService.getWorkflowAnalytics(workspaceId, '30d');
    const perfData = await EnterpriseAnalyticsService.getPerformanceAnalytics(workspaceId, '30d');

    const suggestions: AIOperationsOptimizationSuggestion[] = [];

    // Analyze slowest workflows
    for (const slow of perfData.slowestWorkflows.slice(0, 5)) {
      suggestions.push({
        workflowId: slow.workflowId,
        workflowName: slow.name,
        estimatedLatencyReductionPercent: 35,
        estimatedCostReductionPercent: 20,
        suggestions: [
          {
            type: 'PARALLELIZATION',
            description: `Convert sequential API branches in '${slow.name}' into parallel branches to reduce p95 latency (${slow.p95DurationMs}ms).`,
            impact: 'HIGH',
          },
          {
            type: 'CACHING',
            description: 'Cache repeated database lookups across steps to avoid redundant network round-trips.',
            impact: 'MEDIUM',
          },
        ],
      });
    }

    // If no slow workflows, generate generic best-practice recommendations
    if (suggestions.length === 0 && workflowsData.workflows.length > 0 && workflowsData.workflows[0]) {
      const first = workflowsData.workflows[0];
      suggestions.push({
        workflowId: first.workflowId,
        workflowName: first.name,
        estimatedLatencyReductionPercent: 15,
        estimatedCostReductionPercent: 10,
        suggestions: [
          {
            type: 'RETRY_POLICY',
            description: 'Tune backoff multipliers to prevent thundering herd on downstream API rate limits.',
            impact: 'MEDIUM',
          },
          {
            type: 'TIMEOUT_TUNING',
            description: 'Set explicit step timeouts of 5000ms to fail fast on unresponsive external endpoints.',
            impact: 'LOW',
          },
        ],
      });
    }

    return suggestions;
  }

  /**
   * Detect system anomalies across executions and metrics
   */
  public static async detectSystemAnomalies(
    workspaceId: string
  ): Promise<{
    anomalies: Array<{
      id: string;
      type: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      description: string;
      detectedAt: string;
      recommendation: string;
    }>;
  }> {
    const [security, metrics, overview] = await Promise.all([
      AuditIntelligenceService.getSecurityIntelligence(workspaceId),
      ObservabilityService.getSystemMetrics(),
      EnterpriseAnalyticsService.getOverviewAnalytics(workspaceId, '24h'),
    ]);

    const anomalies: Array<{
      id: string;
      type: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      description: string;
      detectedAt: string;
      recommendation: string;
    }> = [];

    if (metrics.apiErrorRatePercent > 10) {
      anomalies.push({
        id: 'ANOM-01',
        type: 'ERROR_BURST',
        severity: 'HIGH',
        description: `API error rate spiked to ${metrics.apiErrorRatePercent}% in the last 60 minutes.`,
        detectedAt: new Date().toISOString(),
        recommendation: 'Check error logs in the Execution Monitoring console.',
      });
    }

    if (security.failedAuthTrends.totalFailedAttempts > 30) {
      anomalies.push({
        id: 'ANOM-02',
        type: 'SECURITY_AUTH_BURST',
        severity: 'CRITICAL',
        description: `Detected ${security.failedAuthTrends.totalFailedAttempts} failed logins targeting ${security.failedAuthTrends.targetedAccountsCount} accounts.`,
        detectedAt: new Date().toISOString(),
        recommendation: 'Enforce MFA and enable IP rate limiting.',
      });
    }

    if (anomalies.length === 0) {
      anomalies.push({
        id: 'ANOM-00',
        type: 'NORMAL_BASELINE',
        severity: 'LOW',
        description: 'System operating within standard baseline performance and error thresholds.',
        detectedAt: new Date().toISOString(),
        recommendation: 'Continuous anomaly monitoring active.',
      });
    }

    return { anomalies };
  }

  /**
   * Recommend worker cluster scaling actions
   */
  public static async recommendScalingActions(
    workspaceId: string
  ): Promise<{
    currentConcurrency: number;
    recommendedWorkers: number;
    estimatedThroughputGainPercent: number;
    reasoning: string;
    recommendations: string[];
  }> {
    const metrics = await ObservabilityService.getSystemMetrics();

    let recommendedWorkers = 4;
    let estimatedThroughputGainPercent = 0;
    let reasoning = 'Current worker pool is sufficient for current throughput demands.';

    if (metrics.queueDepth > 20 || metrics.workerUtilizationPercent > 80) {
      recommendedWorkers = 8;
      estimatedThroughputGainPercent = 45;
      reasoning = `Queue depth is ${metrics.queueDepth} with ${metrics.workerUtilizationPercent}% worker utilization. Scaling to 8 workers will clear queue backlog.`;
    }

    return {
      currentConcurrency: 10,
      recommendedWorkers,
      estimatedThroughputGainPercent,
      reasoning,
      recommendations: [
        `Scale worker cluster to ${recommendedWorkers} instances.`,
        'Enable auto-scaling based on queue depth threshold > 15 jobs.',
        'Configure Redis memory limit alert at 80% usage.',
      ],
    };
  }
}

export default AIOperationsAssistantService;
