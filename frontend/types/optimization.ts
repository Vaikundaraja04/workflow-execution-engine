// Phase 12.5 - Autonomous Workflow Optimization Platform frontend types.

export type OptimizationType =
  | 'PERFORMANCE_OPTIMIZATION'
  | 'COST_OPTIMIZATION'
  | 'RELIABILITY_OPTIMIZATION'
  | 'ARCHITECTURE_OPTIMIZATION'
  | 'SECURITY_OPTIMIZATION'
  | 'MIXED';

export type OptimizationPlanStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'FAILED';
export type OptimizationRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface OptimizationChange {
  kind: 'UPDATE_NODE_CONFIG' | 'ADD_EDGE' | 'REMOVE_EDGE' | 'ADD_NODE';
  nodeId?: string;
  config?: Record<string, unknown>;
  edge?: { source: string; target: string; condition?: 'true' | 'false' };
  node?: { id: string; type: string; config: Record<string, unknown> };
}

export interface OptimizationRecommendation {
  id: string;
  type: Exclude<OptimizationType, 'MIXED'>;
  title: string;
  description: string;
  expectedImprovement: {
    metric: string;
    value: number;
    unit: 'percent' | 'ms' | 'usd' | 'count';
    description: string;
  };
  confidence: number;
  riskLevel: OptimizationRiskLevel;
  requiresApproval: boolean;
  changes: OptimizationChange[];
  evidence?: string[];
}

export interface OptimizationExpectedImpact {
  latencyReductionPercent?: number;
  costReductionPercent?: number;
  reliabilityGainPercent?: number;
  summary: string;
}

export interface DetectedBottleneck {
  id: string;
  category: Exclude<OptimizationType, 'MIXED'>;
  nodeId?: string;
  description: string;
  evidence: string[];
  severity: OptimizationRiskLevel;
}

export interface NodePerformanceStat {
  nodeId: string;
  nodeType: string;
  runs: number;
  failures: number;
  failureRate: number;
  avgDurationMs?: number;
  timeouts: number;
}

export interface WorkflowPerformanceProfile {
  workflowId: string;
  workflowName: string;
  workspaceId: string;
  sampleSize: number;
  windowDays: number;
  durations: { avgMs: number; p50Ms: number; p95Ms: number; p99Ms: number; trend: 'IMPROVING' | 'STABLE' | 'DEGRADING' };
  reliability: { successRate: number; failureRate: number; totalRetries: number; retryFrequency: number; timeoutExecutions: number };
  cost: { totalAiCostUsd: number; estimatedWorkflowAiCostUsd: number; avgCostPerExecutionUsd: number };
  nodes: NodePerformanceStat[];
  analyzedAt: string;
}

export interface WorkflowAnalysisResult {
  workflowId: string;
  workflowName: string;
  performance: WorkflowPerformanceProfile;
  bottlenecks: DetectedBottleneck[];
  analyzedAt: string;
}

export interface IWorkflowOptimizationPlan {
  _id: string;
  workspaceId: string;
  workflowId: string;
  createdBy: string;
  type: OptimizationType;
  status: OptimizationPlanStatus;
  recommendations: OptimizationRecommendation[];
  confidence: number;
  riskLevel: OptimizationRiskLevel;
  expectedImpact: OptimizationExpectedImpact;
  approvalRequired: boolean;
  aiExplanation?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  appliedBy?: string;
  appliedAt?: string;
  appliedVersionId?: string;
  appliedVersionNumber?: number;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}