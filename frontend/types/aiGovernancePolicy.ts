import type { WorkspaceRole } from './workspace';

export const GOVERNANCE_POLICY_TYPES = [
  'MODEL_ACCESS',
  'FEATURE',
  'PROMPT',
  'PRIVACY',
  'USAGE_LIMIT',
  'APPROVAL',
  'AGENT_TOOL',
] as const;

export type GovernancePolicyType = (typeof GOVERNANCE_POLICY_TYPES)[number];

export const GOVERNANCE_FEATURES = [
  'AI_WORKFLOW_CREATE',
  'AI_ANALYSIS',
  'AI_OPTIMIZATION',
  'AI_AGENT',
] as const;

export type GovernanceFeature = (typeof GOVERNANCE_FEATURES)[number];

export const PII_DATA_CLASSES = [
  'email',
  'phone',
  'ssn',
  'creditCard',
  'apiKey',
  'bearerToken',
  'privateKey',
  'password',
] as const;

export type PIIDataClass = (typeof PII_DATA_CLASSES)[number];

export interface AIModelAccessPolicyDTO {
  _id?: string;
  policyType?: 'MODEL_ACCESS';
  allowedModels: string[];
  blockedModels: string[];
  allowedRoles: WorkspaceRole[];
  status: 'ACTIVE' | 'DISABLED';
}

export interface AIFeaturePolicyDTO {
  _id?: string;
  policyType?: 'FEATURE';
  feature: GovernanceFeature;
  allowedRoles: WorkspaceRole[];
  enabled: boolean;
}

export interface AIPromptPolicyDTO {
  _id?: string;
  policyType?: 'PROMPT';
  blockedPatterns: string[];
  requiredApprovalPatterns: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface PIIRedactionRuleDTO {
  dataClass: PIIDataClass;
  action: 'REDACT' | 'BLOCK';
  pattern?: string;
}

export interface AIPrivacyPolicyDTO {
  _id?: string;
  policyType?: 'PRIVACY';
  allowedDataClasses: PIIDataClass[];
  redactionRules: PIIRedactionRuleDTO[];
  blockSensitiveData: boolean;
}
export interface AIUsageLimitPolicyDTO {
  _id?: string;
  policyType?: 'USAGE_LIMIT';
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  dailyCostLimit: number;
  monthlyCostLimit: number;
  actionOnExceeded: 'THROTTLE' | 'BLOCK';
}

export interface AIApprovalPolicyDTO {
  _id?: string;
  policyType?: 'APPROVAL';
  conditions: {
    premiumModel: boolean;
    highCost: boolean;
    riskLevel: boolean;
    sensitivePrompt: boolean;
  };
  highCostThresholdUSD: number;
  requiredApproverRole: WorkspaceRole;
}

export interface AgentToolPolicyDTO {
  _id?: string;
  policyType?: 'AGENT_TOOL';
  toolName: string;
  policy: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
}

export type GovernancePolicyDTO =
  | AIModelAccessPolicyDTO
  | AIFeaturePolicyDTO
  | AIPromptPolicyDTO
  | AIPrivacyPolicyDTO
  | AIUsageLimitPolicyDTO
  | AIApprovalPolicyDTO
  | AgentToolPolicyDTO;

export type GovernanceDecision = 'ALLOW' | 'ALLOW_REDACTED' | 'THROTTLE' | 'REQUIRE_APPROVAL' | 'DENY';

export interface GovernanceDecisionDTO {
  decision: GovernanceDecision;
  operationId: string;
  reasons: string[];
  reasonCodes: string[];
  redactions: string[];
  matchedPatterns: string[];
  requiredApproval: boolean;
  approvalId?: string;
  requiredApproverRole?: WorkspaceRole;
  redactedPrompt?: string;
  throttled: boolean;
  evaluatedAt: string;
}

export interface GovernanceAuditEventDTO {
  id: string;
  action: string;
  userId: string | null;
  resource: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface GovernanceAuditSummaryDTO {
  timeframe: string;
  decisions: {
    allowed: number;
    denied: number;
    approvalRequired: number;
    approved: number;
    rejected: number;
  };
  usage: {
    tokens: number;
    requests: number;
    costUSD: number;
    byFeature: Array<{ feature: string; tokens: number; costUSD: number }>;
    topModels: Array<{ model: string; tokens: number; costUSD: number }>;
  };
  approvals: { pending: number };
}

export interface AIOperationApprovalDTO {
  _id: string;
  resourceType: string;
  resourceId: string;
  action: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
  requestedBy: string;
  payload?: Record<string, unknown>;
  createdAt: string;
  decidedAt?: string;
}