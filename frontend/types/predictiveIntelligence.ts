// Phase 12.4 — Predictive Intelligence Platform frontend type definitions.

export type PredictionType = 'failure' | 'performance' | 'capacity' | 'cost';
export type PredictionHorizon = '1h' | '6h' | '24h' | '7d' | '30d';
export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type PredictionAlertStatus = 'active' | 'acknowledged' | 'resolved' | 'dismissed';

export interface FailurePredictionResult {
  workspaceId: string;
  failureProbability: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskyNodes: Array<{
    nodeId: string;
    nodeType: string;
    failureLikelihood: number;
    contributingFactors: string[];
  }>;
  confidenceScore: number;
  horizon: PredictionHorizon;
  modelVersion: string;
  predictedAt: string;
}

export interface PerformancePredictionResult {
  workspaceId: string;
  predictedDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  latencySpikeRisk: 'none' | 'low' | 'medium' | 'high';
  confidenceScore: number;
  horizon: PredictionHorizon;
  modelVersion: string;
  predictedAt: string;
}

export interface CapacityPredictionResult {
  workspaceId: string;
  queueDepthPrediction: number;
  queueThroughputPrediction: number;
  recommendedWorkerCount: number;
  currentWorkerCount: number;
  utilizationRate: number;
  queueGrowthRate: number;
  confidenceScore: number;
  horizon: PredictionHorizon;
  modelVersion: string;
  predictedAt: string;
}

export interface CostPredictionResult {
  workspaceId: string;
  monthlyAiCostPrediction: number;
  monthlyExecutionCostPrediction: number;
  monthlyStorageCostPrediction: number;
  currentMonthlyAiCost: number;
  currentMonthlyExecutionCost: number;
  currentMonthlyStorageCost: number;
  storageGrowthRateGBPerMonth: number;
  totalMonthlyPrediction: number;
  confidenceScore: number;
  horizon: PredictionHorizon;
  modelVersion: string;
  predictedAt: string;
}

export interface IPredictionAlert {
  _id: string;
  workspaceId: string;
  type: PredictionType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  prediction: Record<string, any>;
  recommendation: string;
  status: PredictionAlertStatus;
  predictedAt: string;
  horizon: PredictionHorizon;
  modelVersion: string;
  featuresUsed: string[];
  resolvedAt?: string;
  resolvedBy?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  acknowledgedNote?: string;
  createdAt: string;
  updatedAt: string;
}