import { Types } from 'mongoose';
import { AIProviderFactory } from './ai/AIProviderFactory.js';
import type { ExecutionAnalysisInput } from './ai/AIProvider.js';
import { AISecurityService } from './ai/aiSecurityService.js';
import { AIUsageService } from './aiUsageService.js';
import { createAuditLog } from './auditService.js';
import { AIGovernanceGate } from './aiGovernanceGate.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';

export interface AnalyzeExecutionResult {
  summary: string;
  rootCause: string;
  affectedNode: string | null;
  suggestedFix: string;
  confidence: number;
}

export class AIFailureAnalysisService {
  private static instance: AIFailureAnalysisService;

  public static getInstance(): AIFailureAnalysisService {
    if (!AIFailureAnalysisService.instance) {
      AIFailureAnalysisService.instance = new AIFailureAnalysisService();
    }
    return AIFailureAnalysisService.instance;
  }

  async analyzeExecution(
    executionId: Types.ObjectId | string,
    userId: Types.ObjectId | string
  ): Promise<AnalyzeExecutionResult> {
    // 1. Get execution data
    const execution = await WorkflowExecutionModel.findById(executionId);
    if (!execution) {
      throw new Error('EXECUTION_NOT_FOUND: Execution not found');
    }

    // 2. Get associated workflow
    const workflow = await WorkflowModel.findById(execution.workflowId);

    // 3. Security: Prepare sanitized execution data for AI
    const definition = workflow?.draftDefinition || {};
    const errorMessage = execution.error?.message || (execution.error ? String(execution.error) : null);
    const duration = execution.finishedAt && execution.startedAt
      ? execution.finishedAt.getTime() - execution.startedAt.getTime()
      : undefined;

    const sanitizedExecutionData: ExecutionAnalysisInput = {
      executionId: execution.id.toString(),
      status: execution.status,
      error: errorMessage,
      ...(execution.result?.errors ? { errors: execution.result.errors } : {}),
      ...(execution.result?.stepStatuses ? { stepStatuses: execution.result.stepStatuses as Record<string, string> } : {}),
      ...(execution.result?.executionHistory ? { executionHistory: execution.result.executionHistory } : {}),
      ...(duration !== undefined ? { duration } : {}),
      retryAttempts: execution.attemptsMade ?? execution.retryCount ?? 0,
      workflowDefinition: AISecurityService.sanitizeMetadata(
        typeof definition === 'object' && definition !== null
          ? (definition as Record<string, unknown>)
          : {}
      ),
    };

    // 4. Resolve Provider for workspace
    const workspaceId = execution.workspaceId || workflow?.workspaceId;
    const { provider, model, providerName } = await AIProviderFactory.getProviderForWorkspace(
      workspaceId,
      'failureAnalysis'
    );

    if (workspaceId) {
      const governance = await AIGovernanceGate.getInstance().authorize({
        workspaceId: workspaceId.toString(),
        userId: userId.toString(),
        feature: 'AI_ANALYSIS',
        model,
      });
      if (governance.decision === 'DENY') throw new Error('AI_GOVERNANCE_DENIED');
      if (governance.decision === 'REQUIRE_APPROVAL') throw new Error('AI_GOVERNANCE_APPROVAL_REQUIRED');
    }

    // 5. AI analysis
    const result = await provider.analyzeExecution(sanitizedExecutionData);

    // 6. Record Usage
    if (workspaceId) {
      await AIUsageService.recordUsage({
        workspaceId,
        userId,
        feature: 'failure_analysis',
        model,
      });
    }

    // 7. Audit Log
    await createAuditLog({
      action: 'AI_FAILURE_ANALYSIS_REQUESTED',
      userId,
      workspaceId: workspaceId || undefined,
      metadata: {
        executionId: execution.id.toString(),
        provider: providerName,
        model,
        workflowId: execution.workflowId?.toString(),
        status: execution.status,
        hasError: !!execution.error,
      },
    });

    return result;
  }
}

export default AIFailureAnalysisService.getInstance();
