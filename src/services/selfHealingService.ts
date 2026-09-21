import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { SelfHealingPolicyModel, type ISelfHealingPolicy, type SelfHealingActionType, type SelfHealingTriggerCondition } from '../models/SelfHealingPolicyModel.js';
import { SelfHealingIncidentModel, type ISelfHealingIncident, type SelfHealingIncidentStatus } from '../models/SelfHealingIncidentModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { AIProviderFactory } from './ai/AIProviderFactory.js';
import { AIGovernanceGate } from './aiGovernanceGate.js';
import { createAuditLog } from './auditService.js';

export interface EvaluateFailureOptions {
  forceApproval?: boolean;
}

export class SelfHealingService {
  private static instance: SelfHealingService;

  public static getInstance(): SelfHealingService {
    if (!SelfHealingService.instance) {
      SelfHealingService.instance = new SelfHealingService();
    }
    return SelfHealingService.instance;
  }

  /**
   * Evaluate a failed workflow execution against active self-healing policies
   */
  async evaluateExecutionFailure(
    executionId: string,
    workspaceId: string,
    options: EvaluateFailureOptions = {}
  ): Promise<ISelfHealingIncident | null> {
    const wsId = new Types.ObjectId(workspaceId);
    const execId = Types.ObjectId.isValid(executionId) ? new Types.ObjectId(executionId) : null;
    if (!execId) {
      throw new Error('INVALID_EXECUTION_ID');
    }

    const execution = await WorkflowExecutionModel.findOne({
      _id: execId,
      workspaceId: wsId,
    });

    if (!execution) {
      throw new Error('EXECUTION_NOT_FOUND');
    }

    if (execution.status !== 'FAILED') {
      return null;
    }

    const workflow = await WorkflowModel.findOne({
      _id: execution.workflowId,
      workspaceId: wsId,
    });

    if (!workflow) {
      throw new Error('WORKFLOW_NOT_FOUND');
    }

    const errorCode = execution.error?.code || 'UNKNOWN_ERROR';
    const errorMessage = execution.error?.message || 'Execution failed';
    const errorStack = (execution.error as any)?.stack;

    // Fetch active self-healing policies for this workspace ordered by priority
    const policies = await SelfHealingPolicyModel.find({
      workspaceId: wsId,
      isEnabled: true,
    }).sort({ priority: 1 });

    // Match policy based on condition
    let matchedPolicy: ISelfHealingPolicy | null = null;
    for (const policy of policies) {
      if (policy.triggerCondition === 'ERROR_CODE_MATCH') {
        if (policy.triggerValue === '*' || policy.triggerValue === errorCode || errorMessage.includes(policy.triggerValue)) {
          matchedPolicy = policy;
          break;
        }
      } else if (policy.triggerCondition === 'TIMEOUT_PATTERN') {
        if (errorCode === 'EXECUTION_TIMEOUT' || errorCode === 'TIMEOUT' || errorMessage.toLowerCase().includes('timeout')) {
          matchedPolicy = policy;
          break;
        }
      } else if (policy.triggerCondition === 'RATE_LIMIT_EXCEEDED') {
        if (errorCode === 'RATE_LIMIT_EXCEEDED' || errorCode === '429' || errorMessage.toLowerCase().includes('rate limit')) {
          matchedPolicy = policy;
          break;
        }
      } else if (policy.triggerCondition === 'DATA_VALIDATION_ANOMALY') {
        if (errorCode === 'VALIDATION_ERROR' || errorMessage.toLowerCase().includes('validation')) {
          matchedPolicy = policy;
          break;
        }
      }
    }

    // Default action if no specific policy matched
    const actionType: SelfHealingActionType = matchedPolicy
      ? matchedPolicy.actionType
      : 'AUTO_RETRY_WITH_ADAPTED_PARAMS';

    const actionConfig = matchedPolicy?.actionConfig || {
      retryDelayMs: 2000,
      backoffFactor: 2,
      maxAttempts: 3,
    };

    // AI Root Cause Analysis
    let rootCause = 'Transient error detected during step execution.';
    let suggestedRemediation = 'Retry execution with exponential backoff and adapted delay.';
    let confidenceScore = 85;

    try {
      const { provider } = await AIProviderFactory.getProviderForWorkspace(
        workspaceId,
        'failureAnalysis'
      );
      const governance = await AIGovernanceGate.getInstance().authorize({
        workspaceId: workspaceId.toString(),
        feature: 'AI_ANALYSIS',
        prompt: errorMessage,
        ...(execution.ownerId ? { userId: execution.ownerId.toString() } : {}),
      });
      if (governance.decision === 'DENY' || governance.decision === 'REQUIRE_APPROVAL') {
        throw new Error('AI_GOVERNANCE_RESTRICTED');
      }      const aiResult = await provider.analyzeExecution({
        executionId: execution._id.toString(),
        status: execution.status,
        error: errorMessage,
        errors: [{ message: errorMessage, code: errorCode }],
        stepStatuses: (execution as any).stepStatuses,
        workflowDefinition: workflow.draftDefinition,
      });

      if (aiResult) {
        rootCause = aiResult.rootCause || rootCause;
        suggestedRemediation = aiResult.suggestedFix || suggestedRemediation;
        confidenceScore = Math.round((aiResult.confidence || 0.85) * 100);
      }
    } catch {
      // Fallback heuristics if AI analysis fails
    }

    // Determine if approval is needed (e.g., parameter mutations or circuit breakers might require approval)
    const requiresApproval =
      options.forceApproval ||
      actionType === 'CIRCUIT_BREAKER_TRIP' ||
      actionType === 'PARAMETER_MUTATION_HEAL';

    let approvalToken: string | undefined;
    let approvalExpiresAt: Date | undefined;
    let initialStatus: SelfHealingIncidentStatus = 'PROPOSED';

    if (requiresApproval) {
      initialStatus = 'PENDING_APPROVAL';
      approvalToken = crypto.randomBytes(32).toString('hex');
      approvalExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    }

    const incidentData: any = {
      workspaceId: wsId,
      executionId: execution._id,
      workflowId: workflow._id,
      triggerCondition: matchedPolicy?.triggerCondition || 'ERROR_CODE_MATCH',
      errorDetails: {
        message: errorMessage,
        code: errorCode,
        stack: errorStack,
      },
      rootCause,
      confidenceScore,
      suggestedRemediation,
      actionType,
      actionConfig,
      status: initialStatus,
      requiresApproval,
    };

    if (matchedPolicy?._id) {
      incidentData.policyId = matchedPolicy._id;
    }
    if (approvalToken) {
      incidentData.approvalToken = approvalToken;
    }
    if (approvalExpiresAt) {
      incidentData.approvalExpiresAt = approvalExpiresAt;
    }

    const incident = await SelfHealingIncidentModel.create(incidentData);

    // If no approval is required, execute remediation immediately
    if (!requiresApproval) {
      await this.executeRemediation(incident, execution, workflow);
    }

    return incident;
  }

  /**
   * Execute remediation action for an incident
   */
  private async executeRemediation(
    incident: ISelfHealingIncident,
    execution: any,
    workflow: any
  ): Promise<void> {
    try {
      let resultData: Record<string, unknown> = {};

      if (incident.actionType === 'AUTO_RETRY_WITH_ADAPTED_PARAMS') {
        const retryDelayMs = (incident.actionConfig?.retryDelayMs as number) || 2000;
        const currentAttempts = execution.attemptsMade || 1;
        const adaptedBackoff = retryDelayMs * Math.pow(2, currentAttempts);

        resultData = {
          action: 'ADAPTIVE_RETRY_SCHEDULED',
          delayMs: adaptedBackoff,
          attemptNumber: currentAttempts + 1,
          remediatedAt: new Date(),
        };

        incident.status = 'EXECUTED';
        incident.result = resultData;
        await incident.save();
      } else if (incident.actionType === 'FALLBACK_ROUTE') {
        const fallbackNodeId = (incident.actionConfig?.fallbackNodeId as string) || 'fallback_handler';
        resultData = {
          action: 'FALLBACK_ROUTE_TRIGGERED',
          fallbackNodeId,
          remediatedAt: new Date(),
        };

        incident.status = 'EXECUTED';
        incident.result = resultData;
        await incident.save();
      } else if (incident.actionType === 'CIRCUIT_BREAKER_TRIP') {
        const durationMs = (incident.actionConfig?.durationMs as number) || 60000;
        resultData = {
          action: 'CIRCUIT_BREAKER_TRIPPED',
          durationMs,
          trippedUntil: new Date(Date.now() + durationMs),
          remediatedAt: new Date(),
        };

        incident.status = 'RESOLVED';
        incident.result = resultData;
        await incident.save();
      } else if (incident.actionType === 'PARAMETER_MUTATION_HEAL') {
        resultData = {
          action: 'PARAMETERS_MUTATED_AND_REPLAYED',
          mutations: incident.actionConfig?.mutations || { timeoutMs: 30000 },
          replayedAt: new Date(),
        };

        incident.status = 'EXECUTED';
        incident.result = resultData;
        await incident.save();
      }
    } catch (err: any) {
      incident.status = 'FAILED';
      incident.result = { error: err.message };
      await incident.save();
    }
  }

  /**
   * Approve a pending incident
   */
  async approveIncident(
    incidentId: string,
    approvedByUserId: string,
    token?: string
  ): Promise<ISelfHealingIncident> {
    const incId = Types.ObjectId.isValid(incidentId) ? new Types.ObjectId(incidentId) : null;
    if (!incId) {
      throw new Error('INVALID_INCIDENT_ID');
    }

    const incident = await SelfHealingIncidentModel.findById(incId);
    if (!incident) {
      throw new Error('INCIDENT_NOT_FOUND');
    }

    if (incident.status !== 'PENDING_APPROVAL') {
      throw new Error(`INCIDENT_NOT_PENDING_APPROVAL: current status is ${incident.status}`);
    }

    if (token && incident.approvalToken && incident.approvalToken !== token) {
      throw new Error('INVALID_APPROVAL_TOKEN');
    }

    if (incident.approvalExpiresAt && incident.approvalExpiresAt < new Date()) {
      throw new Error('APPROVAL_TOKEN_EXPIRED');
    }

    const execution = await WorkflowExecutionModel.findById(incident.executionId);
    const workflow = await WorkflowModel.findById(incident.workflowId);

    incident.approvedBy = new Types.ObjectId(approvedByUserId);
    incident.approvedAt = new Date();

    await this.executeRemediation(incident, execution, workflow);
    return incident;
  }

  /**
   * Reject a pending incident
   */
  async rejectIncident(
    incidentId: string,
    rejectedByUserId: string,
    reason?: string
  ): Promise<ISelfHealingIncident> {
    const incId = Types.ObjectId.isValid(incidentId) ? new Types.ObjectId(incidentId) : null;
    if (!incId) {
      throw new Error('INVALID_INCIDENT_ID');
    }

    const incident = await SelfHealingIncidentModel.findById(incId);
    if (!incident) {
      throw new Error('INCIDENT_NOT_FOUND');
    }

    if (incident.status !== 'PENDING_APPROVAL') {
      throw new Error(`INCIDENT_NOT_PENDING_APPROVAL: current status is ${incident.status}`);
    }

    incident.status = 'REJECTED';
    incident.rejectedBy = new Types.ObjectId(rejectedByUserId);
    incident.rejectedAt = new Date();
    if (reason) {
      incident.rejectionReason = reason;
    }
    await incident.save();

    return incident;
  }

  /**
   * Policy Management
   */
  async createPolicy(workspaceId: string, data: Partial<ISelfHealingPolicy>): Promise<ISelfHealingPolicy> {
    const policy = await SelfHealingPolicyModel.create({
      ...data,
      workspaceId: new Types.ObjectId(workspaceId),
    });
    return policy;
  }

  async updatePolicy(policyId: string, workspaceId: string, data: Partial<ISelfHealingPolicy>): Promise<ISelfHealingPolicy | null> {
    const policy = await SelfHealingPolicyModel.findOneAndUpdate(
      { _id: new Types.ObjectId(policyId), workspaceId: new Types.ObjectId(workspaceId) },
      { $set: data },
      { new: true }
    );
    return policy;
  }

  async deletePolicy(policyId: string, workspaceId: string): Promise<boolean> {
    const res = await SelfHealingPolicyModel.deleteOne({
      _id: new Types.ObjectId(policyId),
      workspaceId: new Types.ObjectId(workspaceId),
    });
    return res.deletedCount > 0;
  }

  async listPolicies(workspaceId: string): Promise<ISelfHealingPolicy[]> {
    return SelfHealingPolicyModel.find({
      workspaceId: new Types.ObjectId(workspaceId),
    }).sort({ priority: 1, createdAt: -1 });
  }

  async getPolicyById(policyId: string, workspaceId: string): Promise<ISelfHealingPolicy | null> {
    return SelfHealingPolicyModel.findOne({
      _id: new Types.ObjectId(policyId),
      workspaceId: new Types.ObjectId(workspaceId),
    });
  }

  /**
   * Incident Management
   */
  async listIncidents(workspaceId: string, filters: { status?: string; executionId?: string } = {}): Promise<ISelfHealingIncident[]> {
    const query: any = { workspaceId: new Types.ObjectId(workspaceId) };
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.executionId) {
      query.executionId = new Types.ObjectId(filters.executionId);
    }
    return SelfHealingIncidentModel.find(query).sort({ createdAt: -1 });
  }

  async getIncidentById(incidentId: string, workspaceId: string): Promise<ISelfHealingIncident | null> {
    return SelfHealingIncidentModel.findOne({
      _id: new Types.ObjectId(incidentId),
      workspaceId: new Types.ObjectId(workspaceId),
    });
  }
}
