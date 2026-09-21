import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { SelfHealingPolicyModel, type ISelfHealingPolicy, type SelfHealingActionType, type SelfHealingTriggerCondition, type HealingRiskLevel, type HealingAction, type RecoveryPlan } from '../models/SelfHealingPolicyModel.js';
import type { AuditAction } from '../models/AuditLogModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { SelfHealingIncidentModel } from '../models/SelfHealingIncidentModel.js';

export interface FailureContext {
  executionId: string; workspaceId: string; workflowId: string;
  errorCode: string; errorMessage: string; errorStack?: string; failedNodeId?: string;
  executionHistory?: any[]; previousRetries: number; maxRetries: number; attemptsMade: number;
}
export interface HealingDecision {
  actions: HealingAction[]; overallRisk: HealingRiskLevel; requiresApproval: boolean;
  confidence: number; summary: string;
}

export class SelfHealingDecisionService {
  private static instance: SelfHealingDecisionService;
  public static getInstance(): SelfHealingDecisionService {
    if (!SelfHealingDecisionService.instance) SelfHealingDecisionService.instance = new SelfHealingDecisionService();
    return SelfHealingDecisionService.instance;
  }

  async generateRecoveryPlan(ctx: FailureContext): Promise<RecoveryPlan> {
    const policies = await SelfHealingPolicyModel.find({ workspaceId: new Types.ObjectId(ctx.workspaceId), isEnabled: true }).sort({ priority: 1 });
    const matched = policies.filter(p => this.matchesPolicy(p, ctx.errorCode, ctx.errorMessage));
    const actions: HealingAction[] = [];
    for (const p of matched) { const a = this.generateAction(p, ctx); if (a && (!p.allowedActions?.length || p.allowedActions.includes(a.action))) actions.push(a); }
    if (!actions.length) return this.defaultPlan(ctx);
    const risk = this.overallRisk(actions);
    return { actions, overallRisk: risk, requiresApproval: this.needsApproval(actions, ctx), estimatedImpact: this.impactDesc(actions, risk) };
  }

  private matchesPolicy(p: ISelfHealingPolicy, code: string, msg: string): boolean {
    if (p.failureTypes?.length && !p.failureTypes.includes(this.classify(code, msg)) && !p.failureTypes.includes('*')) return false;
    switch (p.triggerCondition) {
      case 'ERROR_CODE_MATCH': return p.triggerValue === '*' || p.triggerValue === code || msg.includes(p.triggerValue);
      case 'TIMEOUT_PATTERN': return code === 'EXECUTION_TIMEOUT' || code === 'TIMEOUT' || msg.toLowerCase().includes('timeout');
      case 'RATE_LIMIT_EXCEEDED': return code === 'RATE_LIMIT_EXCEEDED' || code === '429' || msg.toLowerCase().includes('rate limit');
      case 'DATA_VALIDATION_ANOMALY': return code === 'VALIDATION_ERROR' || msg.toLowerCase().includes('validation');
      default: return false;
    }
  }

  private classify(code: string, msg: string): string {
    const l = msg.toLowerCase();
    if (code === 'EXECUTION_TIMEOUT' || code === 'TIMEOUT' || l.includes('timeout')) return 'timeout';
    if (code === 'RATE_LIMIT_EXCEEDED' || code === '429' || l.includes('rate limit')) return 'rate_limit';
    if (code === 'VALIDATION_ERROR' || l.includes('validation')) return 'validation';
    if (code.includes('NETWORK') || code.includes('CONNECTION') || l.includes('network') || l.includes('connection')) return 'network';
    if (code.includes('AUTH') || l.includes('unauthorized') || l.includes('forbidden')) return 'authorization';
    if (l.includes('not found') || l.includes('missing') || code.includes('NOT_FOUND')) return 'not_found';
    if (l.includes('database') || l.includes('query') || l.includes('pool')) return 'database';
    return 'unknown';
  }



﻿

  private buildReason(at: SelfHealingActionType, p: ISelfHealingPolicy, ctx: FailureContext): string {
    const e = ctx.errorMessage.slice(0, 100);
    const mk = (s: string) => ` "${s}"`;
    const r: Record<string, string> = {
      RETRY_NODE: `Retry node${mk(ctx.failedNodeId || 'unknown')} - ${e}. Policy ${mk(p.name)} recommends retry.`,
      INCREASE_TIMEOUT: `Increase timeout - ${e}. Policy ${mk(p.name)} recommends increased timeout.`,
      CHANGE_PARAMETER: `Change parameters - ${e}. Policy ${mk(p.name)} recommends adjustment.`,
      USE_FALLBACK_NODE: `Use fallback node${mk(ctx.failedNodeId || 'unknown')} - ${e}. Policy ${mk(p.name)} recommends fallback path.`,
      ESCALATE_TO_HUMAN: `Escalate to human - ${e}. Policy ${mk(p.name)} requires manual intervention.`,
      AUTO_RETRY_WITH_ADAPTED_PARAMS: `Auto-retry adapted params - ${e}. Policy ${mk(p.name)} recommends adaptive retry.`,
      FALLBACK_ROUTE: `Trigger fallback route - ${e}. Policy ${mk(p.name)} recommends alternative path.`,
      CIRCUIT_BREAKER_TRIP: `Trip circuit breaker - ${e}. Policy ${mk(p.name)} recommends CB to prevent cascade.`,
      PARAMETER_MUTATION_HEAL: `Apply parameter mutation and replay - ${e}. Policy ${mk(p.name)} recommends mutation.`,
    };
    return r[at] || `Apply ${at} per policy ${mk(p.name)}`;
  }

  private calcConfidence(p: ISelfHealingPolicy, ctx: FailureContext): number {
    let c = 70;
    if (ctx.previousRetries > 2) {
      c -= 15;
    } else if (p.triggerValue === ctx.errorCode) {
      c += 15;
    } else if (p.triggerValue === '*') {
      c -= 10;
    }
    if (ctx.previousRetries > 0 && ctx.previousRetries <= 2) c -= 5;
    if (p.priority <= 5) c += 10;
    return Math.min(95, Math.max(10, c));
  }

  private calcRisk(at: SelfHealingActionType, ctx: Pick<FailureContext, 'previousRetries'>): HealingRiskLevel {
    if (at === 'ESCALATE_TO_HUMAN' || at === 'CIRCUIT_BREAKER_TRIP' || at === 'PARAMETER_MUTATION_HEAL') return 'HIGH';
    if (at === 'USE_FALLBACK_NODE' || at === 'CHANGE_PARAMETER' || at === 'FALLBACK_ROUTE') return ctx.previousRetries > 3 ? 'HIGH' : 'MEDIUM';
    return ctx.previousRetries > 5 ? 'MEDIUM' : 'LOW';
  }

  private needsApprovalAction(at: SelfHealingActionType, p: ISelfHealingPolicy, ctx: FailureContext): boolean {
    if (at === 'ESCALATE_TO_HUMAN' || at === 'CIRCUIT_BREAKER_TRIP') return true;
    if (p.requireApproval) return true; if (ctx.previousRetries > 3) return true;
    if (at === 'PARAMETER_MUTATION_HEAL' || at === 'CHANGE_PARAMETER') return ctx.previousRetries > 1;
    return false;
  }

  private generateAction(p: ISelfHealingPolicy, ctx: FailureContext): HealingAction {
    const actionType = p.actionType;
    const cfg = (p.actionConfig || {}) as Record<string, any>;
    const metadata: Record<string, unknown> = {};

    switch (actionType) {
      case 'RETRY_NODE':
        metadata.nodeId = ctx.failedNodeId || 'unknown';
        metadata.retryCount = ctx.previousRetries + 1;
        metadata.maxRetries = p.maxAutomaticRetries || ctx.maxRetries || 3;
        metadata.delayMs = cfg.delayMs ?? 5000 * (ctx.previousRetries + 1);
        break;
      case 'AUTO_RETRY_WITH_ADAPTED_PARAMS':
        metadata.retryDelayMs = cfg.retryDelayMs ?? 2000;
        metadata.backoffFactor = cfg.backoffFactor ?? 2;
        metadata.attemptNumber = ctx.previousRetries + 1;
        break;
      case 'INCREASE_TIMEOUT':
        metadata.newTimeout = cfg.newTimeoutMs ?? (typeof cfg.timeoutMs === 'number' ? cfg.timeoutMs * 2 : 30000);
        break;
      case 'CHANGE_PARAMETER':
      case 'PARAMETER_MUTATION_HEAL':
        metadata.mutations = cfg.mutations ?? {};
        break;
      case 'USE_FALLBACK_NODE':
        metadata.nodeId = ctx.failedNodeId || 'unknown';
        metadata.fallbackNodeId = cfg.fallbackNodeId ?? 'fallback_handler';
        break;
      case 'FALLBACK_ROUTE':
        metadata.fallbackRoute = cfg.fallbackRoute ?? 'default';
        break;
      case 'CIRCUIT_BREAKER_TRIP':
        metadata.durationMs = cfg.durationMs ?? 60000;
        break;
      case 'ESCALATE_TO_HUMAN':
        metadata.escalationReason = ctx.errorMessage;
        metadata.errorCode = ctx.errorCode;
        if (ctx.failedNodeId) metadata.failedNodeId = ctx.failedNodeId;
        break;
      default:
        break;
    }

    return {
      action: actionType,
      reason: this.buildReason(actionType, p, ctx),
      confidence: this.calcConfidence(p, ctx),
      riskLevel: this.calcRisk(actionType, ctx),
      requiresApproval: this.needsApprovalAction(actionType, p, ctx),
      metadata,
    };
  }

  private toTriggerCondition(failureType: string): SelfHealingTriggerCondition {
    switch (failureType) {
      case 'timeout': return 'TIMEOUT_PATTERN';
      case 'rate_limit': return 'RATE_LIMIT_EXCEEDED';
      case 'validation': return 'DATA_VALIDATION_ANOMALY';
      default: return 'ERROR_CODE_MATCH';
    }
  }



  private overallRisk(actions: HealingAction[]): HealingRiskLevel {
    if (actions.some(a => a.riskLevel === 'HIGH')) return 'HIGH';
    if (actions.some(a => a.riskLevel === 'MEDIUM')) return 'MEDIUM';
    return 'LOW';
  }

  private needsApproval(actions: HealingAction[], ctx: FailureContext): boolean {
    if (actions.some(a => a.requiresApproval)) return true;
    if (ctx.previousRetries > 3) return true;
    return false;
  }

  private impactDesc(actions: HealingAction[], risk: HealingRiskLevel): string {
    const d = actions.map(a => {
      switch (a.action) {
        case 'RETRY_NODE': return `Retry node (${a.metadata?.nodeId})`;
        case 'INCREASE_TIMEOUT': return `Increase timeout to ${a.metadata?.newTimeout}ms`;
        case 'CHANGE_PARAMETER': return 'Modify parameters';
        case 'USE_FALLBACK_NODE': return `Use fallback ${a.metadata?.fallbackNodeId}`;
        case 'ESCALATE_TO_HUMAN': return 'Escalate to human';
        case 'AUTO_RETRY_WITH_ADAPTED_PARAMS': return 'Auto-retry adapted';
        case 'FALLBACK_ROUTE': return 'Fallback route';
        case 'CIRCUIT_BREAKER_TRIP': return `CB ${a.metadata?.durationMs}ms`;
        case 'PARAMETER_MUTATION_HEAL': return 'Mutation replay';
        default: return a.action;
      }
    });
    const r = { LOW: 'Low risk', MEDIUM: 'Medium risk', HIGH: 'High risk' };
    return `Plan: ${d.join(', ')}. ${r[risk]}.`;
  }

  private defaultPlan(ctx: FailureContext): RecoveryPlan {
    const actions: HealingAction[] = [{
      action: 'RETRY_NODE',
      reason: `Default: retry "${ctx.executionId}". Error: ${ctx.errorMessage.slice(0, 100)}`,
      confidence: 60, riskLevel: 'LOW', requiresApproval: false,
      metadata: { nodeId: ctx.failedNodeId || 'unknown', retryCount: ctx.previousRetries + 1, maxRetries: ctx.maxRetries, delayMs: 5000 * (ctx.previousRetries + 1) },
    }];
    if (ctx.previousRetries >= ctx.maxRetries) {
      actions.push({
        action: 'ESCALATE_TO_HUMAN',
        reason: `Max retries (${ctx.maxRetries}) exceeded. Manual intervention required.`,
        confidence: 85, riskLevel: 'HIGH', requiresApproval: true,
        metadata: { escalationReason: ctx.errorMessage, errorCode: ctx.errorCode, failedNodeId: ctx.failedNodeId, suggestedReviewers: [] },
      });
    }
    return {
      actions,
      overallRisk: actions.some(x => x.riskLevel === 'HIGH') ? 'HIGH' : 'LOW',
      requiresApproval: actions.some(x => x.requiresApproval),
      estimatedImpact: 'Default recovery applied.' + (actions.length > 1 ? ' Escalation recommended.' : '.'),
    };
  }


  async getRecommendations(executionId: string, workspaceId: string): Promise<HealingDecision> {
    const execId = Types.ObjectId.isValid(executionId) ? new Types.ObjectId(executionId) : null;
    if (!execId) throw new Error('INVALID_EXECUTION_ID');
    const execution = await WorkflowExecutionModel.findOne({ _id: execId, workspaceId: new Types.ObjectId(workspaceId) });
    if (!execution) throw new Error('EXECUTION_NOT_FOUND');
    if (execution.status !== 'FAILED') throw new Error('EXECUTION_NOT_FAILED');
    const workflow = await WorkflowModel.findOne({ _id: execution.workflowId, workspaceId: new Types.ObjectId(workspaceId) });
    if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
    const ctx = this.buildFailureContext(execution, workspaceId);
    const plan = await this.generateRecoveryPlan(ctx);
    return {
      actions: plan.actions,
      overallRisk: plan.overallRisk,
      requiresApproval: plan.requiresApproval,
      confidence: plan.actions.reduce((s, x) => s + x.confidence, 0) / plan.actions.length,
      summary: plan.estimatedImpact,
    };
  }

  private buildFailureContext(execution: any, workspaceId: string): FailureContext {
    const history = execution.result?.executionHistory;
    const failedEvent = history?.length
      ? [...history].reverse().find((h: any) => h.toStatus === 'FAILED')
      : undefined;
    const failedNodeId: string | undefined = failedEvent?.nodeId;
    const errorStack: string | undefined = (execution.error as any)?.stack;
    return {
      executionId: execution._id.toString(),
      workflowId: execution.workflowId.toString(),
      workspaceId,
      errorCode: execution.error?.code || 'UNKNOWN_ERROR',
      errorMessage: execution.error?.message || 'Failed',
      ...(errorStack !== undefined ? { errorStack } : {}),
      ...(failedNodeId !== undefined ? { failedNodeId } : {}),
      ...(history !== undefined ? { executionHistory: history } : {}),
      previousRetries: execution.retryCount || 0,
      maxRetries: execution.maxRetries || 3,
      attemptsMade: execution.attemptsMade || 1,
    };
  }

  async applyRecovery(
    executionId: string,
    workspaceId: string,
    actionIndex: number,
    userId: string,
  ): Promise<{ success: boolean; incidentId?: string; execution?: any; error?: string }> {
    const execId = Types.ObjectId.isValid(executionId) ? new Types.ObjectId(executionId) : null;
    if (!execId) throw new Error('INVALID_EXECUTION_ID');

    const execution = await WorkflowExecutionModel.findOne({
      _id: execId,
      workspaceId: new Types.ObjectId(workspaceId),
    });
    if (!execution || execution.status !== 'FAILED') {
      return { success: false, error: 'Execution not in FAILED state' };
    }

    const workflow = await WorkflowModel.findOne({
      _id: execution.workflowId,
      workspaceId: new Types.ObjectId(workspaceId),
    });
    if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');

    const ctx = this.buildFailureContext(execution, workspaceId);

    const plan = await this.generateRecoveryPlan(ctx);
    if (!plan.actions.length) {
      return { success: false, error: 'No recovery actions available' };
    }

    const action =
      plan.actions[actionIndex] ||
      plan.actions.find((a) => !a.requiresApproval) ||
      plan.actions[0];

    if (!action) return { success: false, error: 'No applicable action' };

    if (action.requiresApproval && plan.requiresApproval) {
      const incident = await this.createApprovalIncident(execution, workflow, action, userId);
      return { success: false, incidentId: incident._id.toString(), error: 'Action requires approval' };
    }

    const result = await this.executeAction(action, execution, workflow, userId);
    await this.logAudit(
      'SELF_HEALING_EXECUTED',
      userId,
      workspaceId,
      'execution',
      executionId,
      {
        recoveryAction: action.action,
        riskLevel: action.riskLevel,
        confidence: action.confidence,
      },
    );

    return {
      success: result.success,
      ...(result.execution !== undefined ? { execution: result.execution } : {}),
      ...(result.incidentId !== undefined ? { incidentId: result.incidentId } : {}),
    };
  }


  private async createApprovalIncident(
    execution: any,
    workflow: any,
    action: HealingAction,
    userId: string,
  ): Promise<any> {
    const failureType = this.classify(
      execution.error?.code || 'UNKNOWN_ERROR',
      execution.error?.message || '',
    );
    const nodeId = action.metadata?.nodeId || action.metadata?.failedNodeId;
    const incident = await SelfHealingIncidentModel.create({
      executionId: new Types.ObjectId(execution._id),
      workflowId: new Types.ObjectId(workflow._id),
      workspaceId: new Types.ObjectId(execution.workspaceId),
      triggerCondition: this.toTriggerCondition(failureType),
      errorDetails: {
        message: execution.error?.message || 'Execution failed',
        ...(execution.error?.code ? { code: execution.error.code } : {}),
        ...(nodeId ? { nodeId: String(nodeId) } : {}),
      },
      actionType: action.action,
      actionConfig: {
        ...this.buildInvocation(action, execution, workflow),
        failureType,
        recoveryReason: action.reason,
        riskLevel: action.riskLevel,
        requestedBy: userId,
      },
      status: 'PENDING_APPROVAL',
      requiresApproval: true,
      confidenceScore: action.confidence,
      suggestedRemediation: action.reason,
      approvalToken: crypto.randomBytes(32).toString('hex'),
      approvalExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await this.logAudit(
      'SELF_HEALING_RECOMMENDED',
      userId,
      execution.workspaceId.toString(),
      'incident',
      incident._id.toString(),
      {
        executionId: execution._id.toString(),
        workflowId: workflow._id.toString(),
        recoveryAction: action.action,
        riskLevel: action.riskLevel,
        confidence: action.confidence,
      },
    );

    return incident;
  }


  private async executeAction(
    action: HealingAction,
    execution: any,
    workflow: any,
    userId: string,
  ): Promise<{ success: boolean; execution?: any; incidentId?: string }> {
    const failureType = this.classify(
      execution.error?.code || 'UNKNOWN_ERROR',
      execution.error?.message || '',
    );
    const nodeId = action.metadata?.nodeId || action.metadata?.failedNodeId;
    const baseIncident = {
      executionId: new Types.ObjectId(execution._id),
      workflowId: new Types.ObjectId(workflow._id),
      workspaceId: new Types.ObjectId(execution.workspaceId),
      triggerCondition: this.toTriggerCondition(failureType),
      errorDetails: {
        message: execution.error?.message || 'Execution failed',
        ...(execution.error?.code ? { code: execution.error.code } : {}),
        ...(nodeId ? { nodeId: String(nodeId) } : {}),
      },
      actionType: action.action,
      actionConfig: {
        ...this.buildInvocation(action, execution, workflow),
        failureType,
        recoveryReason: action.reason,
        riskLevel: action.riskLevel,
      },
      requiresApproval: action.requiresApproval,
      confidenceScore: action.confidence,
      suggestedRemediation: action.reason,
    };

    try {
      const incident = await SelfHealingIncidentModel.create({
        ...baseIncident,
        status: 'EXECUTED',
        result: { ...this.buildRecoveryResult(action), executedBy: userId, executedAt: new Date() },
      });

      return { success: true, execution, incidentId: incident._id.toString() };
    } catch (err: any) {
      const incident = await SelfHealingIncidentModel.create({
        ...baseIncident,
        status: 'FAILED',
        result: { error: err.message, executedBy: userId, executedAt: new Date() },
      });

      return { success: false, ...(incident._id ? { incidentId: incident._id.toString() } : {}) };
    }
  }

  private buildRecoveryResult(action: HealingAction): Record<string, unknown> {
    const cfg = (action.metadata || {}) as Record<string, any>;
    const base: Record<string, unknown> = { action: action.action, remediatedAt: new Date() };

    switch (action.action) {
      case 'RETRY_NODE':
        return { ...base, detail: 'NODE_RETRY_SCHEDULED', nodeId: cfg.nodeId, retryCount: cfg.retryCount, delayMs: cfg.delayMs };
      case 'AUTO_RETRY_WITH_ADAPTED_PARAMS':
        return { ...base, detail: 'ADAPTIVE_RETRY_SCHEDULED', retryDelayMs: cfg.retryDelayMs, backoffFactor: cfg.backoffFactor, attemptNumber: cfg.attemptNumber };
      case 'INCREASE_TIMEOUT':
        return { ...base, detail: 'TIMEOUT_INCREASED', newTimeoutMs: cfg.newTimeout };
      case 'CHANGE_PARAMETER':
      case 'PARAMETER_MUTATION_HEAL':
        return { ...base, detail: 'PARAMETERS_MUTATED', mutations: cfg.mutations };
      case 'USE_FALLBACK_NODE':
        return { ...base, detail: 'FALLBACK_NODE_SELECTED', fallbackNodeId: cfg.fallbackNodeId, nodeId: cfg.nodeId };
      case 'FALLBACK_ROUTE':
        return { ...base, detail: 'FALLBACK_ROUTE_TRIGGERED', fallbackRoute: cfg.fallbackRoute };
      case 'CIRCUIT_BREAKER_TRIP':
        return { ...base, detail: 'CIRCUIT_BREAKER_TRIPPED', durationMs: cfg.durationMs };
      case 'ESCALATE_TO_HUMAN':
        return { ...base, detail: 'ESCALATED_TO_HUMAN', escalationReason: cfg.escalationReason };
      default:
        return base;
    }
  }

  private buildInvocation(
    action: HealingAction,
    execution: any,
    workflow: any,
  ): Record<string, any> {
    const base: Record<string, any> = {
      executionId: execution._id.toString(),
      workflowId: workflow._id.toString(),
      workspaceId: execution.workspaceId.toString(),
      action: action.action,
      reason: action.reason,
      riskLevel: action.riskLevel,
      confidence: action.confidence,
      previousRetries: execution.retryCount || 0,
    };

    if (action.metadata) {
      Object.assign(base, action.metadata);
    }

    return base;
  }

  private async logAudit(
    action: AuditAction,
    userId: string,
    workspaceId: string | Types.ObjectId,
    resource: string,
    resourceId: string,
    metadata: Record<string, any>,
  ): Promise<void> {
    const { createAuditLog } = await import('./auditService.js');
    await createAuditLog({
      action,
      userId,
      workspaceId:
        typeof workspaceId === 'string'
          ? workspaceId
          : workspaceId.toString(),
      resource,
      resourceId,
      metadata,
    });
  }
}

