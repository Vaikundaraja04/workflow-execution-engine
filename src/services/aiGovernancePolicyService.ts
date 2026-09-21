import mongoose, { Types } from 'mongoose';
import {
  AIFeaturePolicyModel,
  AIModelAccessPolicyModel,
  AIApprovalPolicyModel,
  AIPrivacyPolicyModel,
  AIPromptPolicyModel,
  AIUsageLimitPolicyModel,
  PII_DATA_CLASSES,
  type AIGovernanceFeature,
  type PIIDataClass,
} from '../models/AIGovernancePolicyModel.js';
import { AIGovernanceBudgetModel } from '../models/AIGovernanceBudgetModel.js';
import { AIUsageModel } from '../models/AIUsageModel.js';
import type { WorkspaceRole } from '../models/WorkspaceMemberModel.js';
import { AISecurityService } from './ai/aiSecurityService.js';
import { findMembership } from './permissionService.js';
import { ApprovalService } from './agent/approvalService.js';
import { createAuditLog } from './auditService.js';
import type { AuditAction } from '../models/AuditLogModel.js';

export type GovernanceDecisionOutcome =
  | 'ALLOW'
  | 'ALLOW_REDACTED'
  | 'THROTTLE'
  | 'REQUIRE_APPROVAL'
  | 'DENY';

export interface AIGovernanceDecision {
  decision: GovernanceDecisionOutcome;
  operationId: string;
  reasons: string[];
  reasonCodes: string[];
  redactions: string[];
  matchedPatterns: string[];
  requiredApproval: boolean;
  requiredApproverRole?: WorkspaceRole;
  approvalId?: string;
  redactedPrompt?: string;
  throttled: boolean;
  evaluatedAt: Date;
}

export interface EvaluateRequestInput {
  workspaceId: string;
  userId?: string;
  role?: WorkspaceRole;
  feature: AIGovernanceFeature;
  model?: string;
  provider?: string;
  prompt?: string;
  estimatedTokens?: number;
  estimatedCostUSD?: number;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  operationId?: string;
  approvalId?: string;
  dryRun?: boolean;
}
const PII_PATTERNS: Record<PIIDataClass, RegExp> = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone: /\+?\d[\d\s().-]{7,}\d/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  creditCard: /\b(?:\d[ -]?){13,16}\b/g,
  apiKey: /sk-[a-zA-Z0-9-_]{20,}/g,
  bearerToken: /Bearer\s+[a-zA-Z0-9_\-.]{10,}/gi,
  privateKey: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
  password: /("?password"?\s*[:=]\s*)("[^"]+"|[^\s,;]+)/gi,
};

const PII_REDACTION_LABELS: Record<PIIDataClass, string> = {
  email: '[REDACTED_EMAIL]',
  phone: '[REDACTED_PHONE]',
  ssn: '[REDACTED_SSN]',
  creditCard: '[REDACTED_CARD]',
  apiKey: '[REDACTED_API_KEY]',
  bearerToken: 'Bearer [REDACTED_TOKEN]',
  privateKey: '[REDACTED_PRIVATE_KEY]',
  password: '$1[REDACTED_PASSWORD]',
};

const PREMIUM_MODEL_PATTERN = /(gpt-4(?!o-mini)|gpt-5|claude-3-opus|claude-opus|o1(-preview)?$)/i;


function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

function matchesModelEntry(candidate: string, model: string): boolean {
  if (candidate === '*') return true;
  if (candidate.endsWith('*')) return model.toLowerCase().startsWith(candidate.slice(0, -1).toLowerCase());
  return candidate.toLowerCase() === model.toLowerCase();
}
interface EvaluationState {
  denied: { code: string; message: string } | null;
  reasons: string[];
  reasonCodes: string[];
  redactions: PIIDataClass[];
  matchedPatterns: string[];
  requiredApproval: boolean;
  requiredApproverRole?: WorkspaceRole;
  throttled: boolean;
  redactedPrompt?: string;
  governanceConfigured: boolean;
}

export class AIGovernancePolicyService {
  private static instance: AIGovernancePolicyService;

  private constructor() {}

  public static getInstance(): AIGovernancePolicyService {
    if (!AIGovernancePolicyService.instance) {
      AIGovernancePolicyService.instance = new AIGovernancePolicyService();
    }
    return AIGovernancePolicyService.instance;
  }

  private deny(state: EvaluationState, code: string, message: string): void {
    if (!state.denied) state.denied = { code, message };
    state.reasonCodes.push(code);
    state.reasons.push(message);
  }

  async evaluateRequest(input: EvaluateRequestInput): Promise<AIGovernanceDecision> {
    const operationId = input.operationId ?? `aiop_${new Types.ObjectId().toHexString()}`;
    const skipDecision = (code: string, message: string): AIGovernanceDecision => ({
      decision: 'ALLOW',
      operationId,
      reasons: [message],
      reasonCodes: [code],
      redactions: [],
      matchedPatterns: [],
      requiredApproval: false,
      throttled: false,
      evaluatedAt: new Date(),
    });
    if (mongoose.connection.readyState !== 1) {
      return skipDecision('GOVERNANCE_DB_UNAVAILABLE', 'Governance evaluation skipped: database connection unavailable');
    }
    if (!Types.ObjectId.isValid(input.workspaceId)) {
      return skipDecision(
        'GOVERNANCE_WORKSPACE_UNAVAILABLE',
        'Governance evaluation skipped: workspace context is not a persisted workspace',
      );
    }
    const workspaceId = new Types.ObjectId(input.workspaceId);

    const state: EvaluationState = {
      denied: null,
      reasons: [],
      reasonCodes: [],
      redactions: [],
      matchedPatterns: [],
      requiredApproval: false,
      throttled: false,
      governanceConfigured: false,
    };

    const role = input.role ?? (await this.resolveRole(input));
    let prompt = input.prompt;

    const featurePolicy = await AIFeaturePolicyModel.findOne({
      workspaceId,
      feature: input.feature,
    }).lean();

    if (featurePolicy) {
      state.governanceConfigured = true;
      if (!featurePolicy.enabled) {
        this.deny(state, 'FEATURE_DISABLED', `AI feature ${input.feature} is disabled by governance policy`);
      }
      if (!state.denied && featurePolicy.allowedRoles.length > 0 && role && !featurePolicy.allowedRoles.includes(role)) {
        this.deny(state, 'ROLE_NOT_ALLOWED', `Role ${role} is not allowed to use AI feature ${input.feature}`);
      }
    }
    if (!state.denied) {
      const modelPolicy = await AIModelAccessPolicyModel.findOne({ workspaceId }).lean();
      if (modelPolicy && modelPolicy.status === 'ACTIVE') {
        state.governanceConfigured = true;
        if (input.model) {
          const blocked = modelPolicy.blockedModels.find((entry) => matchesModelEntry(entry, input.model as string));
          if (blocked) {
            this.deny(state, 'MODEL_BLOCKED', `Model ${input.model} is blocked by governance policy`);
          } else if (
            modelPolicy.allowedModels.length > 0
            && !modelPolicy.allowedModels.some((entry) => matchesModelEntry(entry, input.model as string))
          ) {
            this.deny(state, 'MODEL_NOT_ALLOWED', `Model ${input.model} is not in the allowed model list`);
          }
        }
        if (
          !state.denied
          && modelPolicy.allowedRoles.length > 0
          && role
          && !modelPolicy.allowedRoles.includes(role)
        ) {
          this.deny(state, 'MODEL_ROLE_NOT_ALLOWED', `Role ${role} is not allowed to use workspace AI models`);
        }
      }
    }

    if (!state.denied && prompt) {
      const promptPolicy = await AIPromptPolicyModel.findOne({ workspaceId }).lean();
      if (promptPolicy) {
        state.governanceConfigured = true;
        for (const pattern of promptPolicy.blockedPatterns) {
          const compiled = compilePattern(pattern);
          if (compiled && compiled.test(prompt)) {
            this.deny(state, 'PROMPT_BLOCKED', `Prompt matched blocked pattern ${pattern}`);
            break;
          }
        }
        if (!state.denied) {
          for (const pattern of promptPolicy.requiredApprovalPatterns) {
            const compiled = compilePattern(pattern);
            if (compiled && compiled.test(prompt)) {
              state.matchedPatterns.push(pattern);
              state.requiredApproval = true;
              state.reasonCodes.push('PROMPT_REQUIRES_APPROVAL');
              state.reasons.push(`Prompt matched approval pattern ${pattern}`);
            }
          }
        }
      }
    }
    if (!state.denied && prompt) {
      const privacyPolicy = await AIPrivacyPolicyModel.findOne({ workspaceId }).lean();
      if (privacyPolicy) {
        state.governanceConfigured = true;
        let workingPrompt = prompt;
        for (const dataClass of PII_DATA_CLASSES) {
          const pattern = PII_PATTERNS[dataClass];
          pattern.lastIndex = 0;
          if (!pattern.test(workingPrompt)) continue;
          if (privacyPolicy.allowedDataClasses.includes(dataClass)) continue;
          const rule = privacyPolicy.redactionRules.find((entry) => entry.dataClass === dataClass);
          const action = rule?.action ?? (privacyPolicy.blockSensitiveData ? 'BLOCK' : 'REDACT');
          if (action === 'BLOCK') {
            this.deny(state, 'SENSITIVE_DATA_BLOCKED', `Prompt contains blocked sensitive data class ${dataClass}`);
            break;
          }
          pattern.lastIndex = 0;
          workingPrompt = workingPrompt.replace(pattern, PII_REDACTION_LABELS[dataClass]);
          state.redactions.push(dataClass);
        }
        if (!state.denied) {
          if (workingPrompt !== prompt) state.redactedPrompt = workingPrompt;
          if (state.redactions.length > 0) {
            state.reasonCodes.push('SENSITIVE_DATA_REDACTED');
            state.reasons.push(`Redacted sensitive data classes: ${state.redactions.join(', ')}`);
          }
        }
      }
    }
    if (!state.denied) {
      const budget = await AIGovernanceBudgetModel.findOne({ workspaceId }).lean();
      if (budget) {
        state.governanceConfigured = true;
        const tokenPercent = budget.monthlyTokenLimit > 0
          ? (budget.currentTokenUsage / budget.monthlyTokenLimit) * 100
          : 0;
        const costPercent = budget.monthlyCostLimitUSD > 0
          ? (budget.currentCostUSD / budget.monthlyCostLimitUSD) * 100
          : 0;
        const usagePercent = Math.max(tokenPercent, costPercent);
        if (budget.blockEnabled && usagePercent >= budget.blockThreshold) {
          this.deny(state, 'BUDGET_BLOCKED', `Workspace AI budget reached ${usagePercent.toFixed(1)}% (block threshold ${budget.blockThreshold}%)`);
        } else if (budget.throttleEnabled && usagePercent >= budget.throttleThreshold) {
          state.throttled = true;
          state.reasonCodes.push('BUDGET_THROTTLED');
          state.reasons.push(`Workspace AI budget reached ${usagePercent.toFixed(1)}% (throttle threshold ${budget.throttleThreshold}%)`);
        } else if (budget.alertEnabled && usagePercent >= budget.alertThreshold) {
          state.reasonCodes.push('BUDGET_ALERT');
          state.reasons.push(`Workspace AI budget reached ${usagePercent.toFixed(1)}% (alert threshold ${budget.alertThreshold}%)`);
        }
      }
      const limitPolicy = await AIUsageLimitPolicyModel.findOne({ workspaceId }).lean();
      if (limitPolicy) {
        state.governanceConfigured = true;
        const windowUsage = await this.readWindowedUsage(workspaceId);
        const estimatedTokens = input.estimatedTokens ?? 0;
        const estimatedCost = input.estimatedCostUSD ?? 0;
        const breaches: string[] = [];
        if (limitPolicy.dailyTokenLimit > 0 && windowUsage.dayTokens + estimatedTokens > limitPolicy.dailyTokenLimit) {
          breaches.push(`daily token limit ${limitPolicy.dailyTokenLimit}`);
        }
        if (limitPolicy.monthlyTokenLimit > 0 && windowUsage.monthTokens + estimatedTokens > limitPolicy.monthlyTokenLimit) {
          breaches.push(`monthly token limit ${limitPolicy.monthlyTokenLimit}`);
        }
        if (limitPolicy.dailyCostLimit > 0 && windowUsage.dayCost + estimatedCost > limitPolicy.dailyCostLimit) {
          breaches.push(`daily cost limit ${limitPolicy.dailyCostLimit}`);
        }
        if (limitPolicy.monthlyCostLimit > 0 && windowUsage.monthCost + estimatedCost > limitPolicy.monthlyCostLimit) {
          breaches.push(`monthly cost limit ${limitPolicy.monthlyCostLimit}`);
        }
        if (breaches.length > 0) {
          if (limitPolicy.actionOnExceeded === 'BLOCK') {
            this.deny(state, 'USAGE_LIMIT_BLOCKED', `AI usage limit exceeded: ${breaches.join(', ')}`);
          } else {
            state.throttled = true;
            state.reasonCodes.push('USAGE_LIMIT_THROTTLED');
            state.reasons.push(`AI usage limit throttled: ${breaches.join(', ')}`);
          }
        }
      }
    }
    if (!state.denied) {
      const approvalPolicy = await AIApprovalPolicyModel.findOne({ workspaceId }).lean();
      if (approvalPolicy) {
        state.governanceConfigured = true;
        const conditions = approvalPolicy.conditions;
        const premiumModel = input.model ? PREMIUM_MODEL_PATTERN.test(input.model) : false;
        const highCost = input.estimatedCostUSD !== undefined
          && approvalPolicy.highCostThresholdUSD > 0
          && input.estimatedCostUSD >= approvalPolicy.highCostThresholdUSD;
        const sensitivePrompt = state.redactions.length > 0 || state.matchedPatterns.length > 0;
        const riskyRequest = input.riskLevel === 'HIGH';
        const matchedReasons: string[] = [];
        if (conditions.premiumModel && premiumModel) matchedReasons.push('premium model');
        if (conditions.highCost && highCost) matchedReasons.push('estimated cost above threshold');
        if (conditions.sensitivePrompt && sensitivePrompt) matchedReasons.push('sensitive prompt content');
        if (conditions.riskLevel && riskyRequest) matchedReasons.push('high risk request');
        if (matchedReasons.length > 0) {
          state.requiredApproval = true;
          state.requiredApproverRole = approvalPolicy.requiredApproverRole;
          state.reasonCodes.push('APPROVAL_POLICY_MATCHED');
          state.reasons.push(`Human approval required (${matchedReasons.join(', ')})`);
        }
      }
    }
    let approvalId: string | undefined;
    let requiredApproval = state.requiredApproval;
    let requiredApproverRole = state.requiredApproverRole;

    if (!state.denied && requiredApproval && !input.dryRun) {
      const approvalService = ApprovalService.getInstance();
      if (input.approvalId) {
        const existing = await approvalService.getById(input.approvalId, input.workspaceId);
        if (existing && existing.status === 'APPROVED') {
          requiredApproval = false;
          state.reasonCodes.push('APPROVAL_SATISFIED');
          state.reasons.push(`Approval ${input.approvalId} satisfied the governance requirement`);
        } else if (existing && existing.status === 'PENDING') {
          approvalId = existing._id.toString();
        } else if (existing && existing.status === 'REJECTED') {
          this.deny(state, 'APPROVAL_REJECTED', `Approval request ${input.approvalId} was rejected`);
        } else {
          this.deny(state, 'APPROVAL_NOT_FOUND', `Approval request ${input.approvalId} was not found`);
        }
      } else if (input.userId) {
        const requested = await approvalService.requestApproval(input.workspaceId, input.userId, {
          resourceType: 'AI_OPERATION',
          resourceId: operationId,
          action: input.feature,
          payload: {
            feature: input.feature,
            model: input.model ?? null,
            provider: input.provider ?? null,
            estimatedTokens: input.estimatedTokens ?? null,
            estimatedCostUSD: input.estimatedCostUSD ?? null,
            riskLevel: input.riskLevel ?? null,
            matchedPatterns: state.matchedPatterns,
            requiredApproverRole: requiredApproverRole ?? null,
            reasonCodes: state.reasonCodes,
          },
        });
        approvalId = requested._id.toString();
      } else {
        this.deny(state, 'APPROVAL_REQUIRES_USER', 'Human approval is required but the request has no user context');
      }
    }
    const decision: GovernanceDecisionOutcome = state.denied
      ? 'DENY'
      : requiredApproval
        ? 'REQUIRE_APPROVAL'
        : state.redactedPrompt !== undefined
          ? 'ALLOW_REDACTED'
          : state.throttled
            ? 'THROTTLE'
            : 'ALLOW';

    const result: AIGovernanceDecision = {
      decision,
      operationId,
      reasons: state.reasons,
      reasonCodes: state.reasonCodes,
      redactions: [...state.redactions],
      matchedPatterns: [...state.matchedPatterns],
      requiredApproval,
      throttled: state.throttled,
      evaluatedAt: new Date(),
    };
    if (requiredApproval && requiredApproverRole) result.requiredApproverRole = requiredApproverRole;
    if (approvalId) result.approvalId = approvalId;
    if (state.redactedPrompt !== undefined) result.redactedPrompt = state.redactedPrompt;
    if (state.denied) result.reasons = [...result.reasons, state.denied.message];

    if ((state.governanceConfigured || decision !== 'ALLOW') && !input.dryRun) {
      const auditAction: AuditAction = decision === 'DENY'
        ? 'AI_GOVERNANCE_DENIED'
        : decision === 'REQUIRE_APPROVAL'
          ? 'AI_GOVERNANCE_APPROVAL_REQUIRED'
          : 'AI_GOVERNANCE_ALLOWED';
      await createAuditLog({
        action: auditAction,
        userId: input.userId,
        workspaceId: input.workspaceId,
        resource: 'AI_OPERATION',
        resourceId: operationId,
        metadata: AISecurityService.sanitizeMetadata({
          feature: input.feature,
          model: input.model ?? 'unspecified',
          provider: input.provider ?? 'unspecified',
          decision,
          reasonCodes: state.reasonCodes,
          redactions: state.redactions,
          matchedPatterns: state.matchedPatterns,
          requiredApproval,
          approvalId: approvalId ?? null,
          role: role ?? null,
        }),
      });
    }

    return result;
  }
  /** Read-only AI usage aggregates for DAILY (rolling 24h) and MONTHLY (calendar) windows. */
  async readWindowedUsage(workspaceId: Types.ObjectId): Promise<{
    dayTokens: number;
    monthTokens: number;
    dayCost: number;
    monthCost: number;
  }> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const dayStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await AIUsageModel.aggregate<{
      dayTokens: number;
      monthTokens: number;
      dayCost: number;
      monthCost: number;
    }>([
      { $match: { workspaceId, createdAt: { $gte: monthStart } } },
      {
        $group: {
          _id: null,
          monthTokens: { $sum: '$tokensUsed' },
          monthCost: { $sum: '$costEstimate' },
          dayTokens: { $sum: { $cond: [{ $gte: ['$createdAt', dayStart] }, '$tokensUsed', 0] } },
          dayCost: { $sum: { $cond: [{ $gte: ['$createdAt', dayStart] }, '$costEstimate', 0] } },
        },
      },
    ]);
    const row = rows[0];
    return {
      dayTokens: row?.dayTokens ?? 0,
      monthTokens: row?.monthTokens ?? 0,
      dayCost: row?.dayCost ?? 0,
      monthCost: row?.monthCost ?? 0,
    };
  }

  private async resolveRole(input: EvaluateRequestInput): Promise<WorkspaceRole | undefined> {
    if (input.role) return input.role;
    if (!input.userId) return undefined;
    try {
      const membership = await findMembership(input.workspaceId, input.userId);
      return membership?.role;
    } catch {
      return undefined;
    }
  }
}