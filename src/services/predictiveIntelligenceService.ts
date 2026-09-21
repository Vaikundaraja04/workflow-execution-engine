import { Types } from "mongoose";
import { PredictionAlertModel, type IPredictionAlert } from '../models/PredictionAlertModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { AIUsageModel } from '../models/AIUsageModel.js';
import { WorkspaceUsageModel } from '../models/WorkspaceUsageModel.js';
import { ObservabilityService } from './observabilityService.js';

export type PredictionType = 'failure' | 'performance' | 'capacity' | 'cost';
export type PredictionHorizon = '1h' | '6h' | '24h' | '7d' | '30d';
export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface FailurePredictionInput {
  workspaceId: Types.ObjectId | string;
  workflowId?: Types.ObjectId | string;
  horizon?: PredictionHorizon;
}

export interface FailurePredictionResult {
  workspaceId: string;
  failureProbability: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskyNodes: Array<{ nodeId: string; nodeType: string; failureLikelihood: number; contributingFactors: string[] }>;
  confidenceScore: number;
  horizon: PredictionHorizon;
  modelVersion: string;
  predictedAt: Date;
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
  predictedAt: Date;
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
  predictedAt: Date;
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
  predictedAt: Date;
}

export interface AlertCreateInput {
  workspaceId: Types.ObjectId | string;
  type: PredictionType;
  severity: IPredictionAlert['severity'];
  confidence: number;
  prediction: Record<string, any>;
  recommendation: string;
  horizon?: PredictionHorizon;
  modelVersion?: string;
  featuresUsed?: string[];
}

const MODEL_VERSION = 'v1.0.0';
const HORIZON_MULTIPLIERS: Record<PredictionHorizon, number> = {
  '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720,
};

export class PredictiveIntelligenceService {
  private static instance: PredictiveIntelligenceService;

  private constructor() {}

  public static getInstance(): PredictiveIntelligenceService {
    if (!PredictiveIntelligenceService.instance) {
      PredictiveIntelligenceService.instance = new PredictiveIntelligenceService();
    }
    return PredictiveIntelligenceService.instance;
  }

  private calculateConfidence(dataPoints: number, dataAgeHours: number): number {
    if (dataPoints === 0) return 0;
    const volumeFactor = Math.min(dataPoints / 100, 1);
    const recencyFactor = Math.max(1 - (dataAgeHours / 720), 0);
    return Math.round((volumeFactor * 0.6 + recencyFactor * 0.4) * 100);
  }

  private getConfidenceLevel(score: number): ConfidenceLevel {
    if (score >= 80) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
  }

  private getRiskLevel(probability: number): 'low' | 'medium' | 'high' | 'critical' {
    if (probability >= 80) return 'critical';
    if (probability >= 60) return 'high';
    if (probability >= 40) return 'medium';
    return 'low';
  }

  public async predictFailureProbability(input: FailurePredictionInput): Promise<FailurePredictionResult> {
    const workspaceId = typeof input.workspaceId === 'string' ? new Types.ObjectId(input.workspaceId) : input.workspaceId;
    const horizon = input.horizon || '24h';
    const horizonMultiplier = HORIZON_MULTIPLIERS[horizon];

    const executions = await WorkflowExecutionModel.find({ workspaceId }).sort({ createdAt: -1 }).limit(500).lean();
    const totalExecutions = executions.length;
    const failedExecutions = executions.filter((e: any) => e.status === 'FAILED').length;
    const baseFailureRate = totalExecutions > 0 ? failedExecutions / totalExecutions : 0;

    const nodeFailureCounts = new Map<string, { total: number; failed: number; nodeType: string }>();
    for (const exec of executions) {
      const stepStatuses = (exec as any).stepStatuses || [];
      for (const step of stepStatuses) {
        const nodeId = step.nodeId || 'unknown';
        const nodeType = step.nodeType || 'unknown';
        const existing = nodeFailureCounts.get(nodeId) || { total: 0, failed: 0, nodeType };
        existing.total++;
        if (step.status === 'FAILED') existing.failed++;
        nodeFailureCounts.set(nodeId, existing);
      }
    }

    const riskyNodes = Array.from(nodeFailureCounts.entries())
      .map(([nodeId, stats]) => ({
        nodeId, nodeType: stats.nodeType,
        failureLikelihood: stats.total > 0 ? Math.round((stats.failed / stats.total) * 100) : 0,
        contributingFactors: stats.failed > 0 ? [`Failed ${stats.failed}/${stats.total} executions`] : [],
      }))
      .filter(n => n.failureLikelihood > 0)
      .sort((a, b) => b.failureLikelihood - a.failureLikelihood)
      .slice(0, 10);

    const recentExecutions = executions.filter((e: any) => {
      const age = (Date.now() - new Date(e.createdAt).getTime()) / 3600000;
      return age <= 24;
    });
    const recentFailures = recentExecutions.filter((e: any) => e.status === 'FAILED').length;
    const recentFailureRate = recentExecutions.length > 0 ? recentFailures / recentExecutions.length : 0;

    const failureProbability = Math.round(
      Math.min(100, Math.max(0, (baseFailureRate * 50 + recentFailureRate * 30 + (riskyNodes.length > 0 ? 20 : 0)) * horizonMultiplier / 24))
    );

    const confidenceScore = this.calculateConfidence(totalExecutions, 24);
    const riskLevel = this.getRiskLevel(failureProbability);

    return {
      workspaceId: workspaceId.toString(), failureProbability, riskLevel, riskyNodes,
      confidenceScore, horizon, modelVersion: MODEL_VERSION, predictedAt: new Date(),
    };
  }

  public async predictPerformance(input: { workspaceId: Types.ObjectId | string; workflowId?: Types.ObjectId | string; horizon?: PredictionHorizon }): Promise<PerformancePredictionResult> {
    const workspaceId = typeof input.workspaceId === 'string' ? new Types.ObjectId(input.workspaceId) : input.workspaceId;
    const horizon = input.horizon || '24h';

    const executions = await WorkflowExecutionModel.find({ workspaceId }).sort({ createdAt: -1 }).limit(1000).lean();
    const durations = executions
      .map((e: any) => { if (e.startedAt && e.finishedAt) return new Date(e.finishedAt).getTime() - new Date(e.startedAt).getTime(); return null; })
      .filter((d: number | null) => d !== null) as number[];

    if (durations.length === 0) {
      return { workspaceId: workspaceId.toString(), predictedDurationMs: 0, p50DurationMs: 0, p95DurationMs: 0, p99DurationMs: 0, latencySpikeRisk: 'low', confidenceScore: 0, horizon, modelVersion: MODEL_VERSION, predictedAt: new Date() };
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;

    const spikeRatio = p50 > 0 ? p95 / p50 : 1;
    const latencySpikeRisk: PerformancePredictionResult['latencySpikeRisk'] = spikeRatio > 3 ? 'high' : spikeRatio > 2 ? 'medium' : spikeRatio > 1.5 ? 'low' : 'none';

    const recentDurations = durations.slice(0, 100);
    const olderDurations = durations.slice(100, 200);
    const recentAvg = recentDurations.length > 0 ? recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length : avg;
    const olderAvg = olderDurations.length > 0 ? olderDurations.reduce((a, b) => a + b, 0) / olderDurations.length : avg;
    const trendFactor = olderAvg > 0 ? recentAvg / olderAvg : 1;
    const predictedDurationMs = Math.round(avg * Math.min(trendFactor * (horizon === '1h' ? 1 : horizon === '6h' ? 1.1 : horizon === '24h' ? 1.2 : 1.3), 5));

    const confidenceScore = this.calculateConfidence(durations.length, 24);

    return {
      workspaceId: workspaceId.toString(), predictedDurationMs, p50DurationMs: p50, p95DurationMs: p95, p99DurationMs: p99,
      latencySpikeRisk, confidenceScore, horizon, modelVersion: MODEL_VERSION, predictedAt: new Date(),
    };
  }

  public async predictCapacity(input: { workspaceId: Types.ObjectId | string; horizon?: PredictionHorizon }): Promise<CapacityPredictionResult> {
    const workspaceId = typeof input.workspaceId === 'string' ? new Types.ObjectId(input.workspaceId) : input.workspaceId;
    const horizon = input.horizon || '24h';

    const metrics = await ObservabilityService.getSystemMetrics();
    const horizonMultiplier = HORIZON_MULTIPLIERS[horizon];

    const currentWorkerCount = metrics.workerUtilizationPercent > 0
      ? Math.round(metrics.queueDepth / (metrics.workerUtilizationPercent / 100))
      : 4;

    const queueGrowthRate = metrics.queueDepth > 0 ? Math.round(metrics.queueThroughputRpm * 0.1) : 0;
    const queueDepthPrediction = Math.round(metrics.queueDepth + queueGrowthRate * horizonMultiplier);
    const queueThroughputPrediction = Math.round(metrics.queueThroughputRpm * horizonMultiplier);

    const recommendedWorkerCount = queueDepthPrediction > 50
      ? Math.round(currentWorkerCount * 1.5)
      : queueDepthPrediction > 20 ? Math.round(currentWorkerCount * 1.25) : currentWorkerCount;

    const utilizationRate = Math.round((queueThroughputPrediction / (recommendedWorkerCount * 10)) * 100);
    const confidenceScore = this.calculateConfidence(metrics.queueDepth, 1);

    return {
      workspaceId: workspaceId.toString(), queueDepthPrediction, queueThroughputPrediction,
      recommendedWorkerCount: Math.max(1, recommendedWorkerCount), currentWorkerCount: Math.max(1, currentWorkerCount),
      utilizationRate: Math.min(100, Math.max(0, utilizationRate)), queueGrowthRate, confidenceScore, horizon,
      modelVersion: MODEL_VERSION, predictedAt: new Date(),
    };
  }

  public async predictCost(input: { workspaceId: Types.ObjectId | string; horizon?: PredictionHorizon }): Promise<CostPredictionResult> {
    const workspaceId = typeof input.workspaceId === 'string' ? new Types.ObjectId(input.workspaceId) : input.workspaceId;
    const horizon = input.horizon || '24h';

    const [aiUsage, workspaceUsage] = await Promise.all([
      AIUsageModel.aggregate([{ $match: { workspaceId } }, { $group: { _id: null, totalTokens: { $sum: '$tokensUsed' }, totalCost: { $sum: '$estimatedCost' }, count: { $sum: 1 } } }]),
      WorkspaceUsageModel.findOne({ workspaceId }).lean(),
    ]);

    const currentMonthlyAiCost = aiUsage[0]?.totalCost || 0;
    const currentMonthlyExecutionCost = currentMonthlyAiCost * 0.6;
    const currentMonthlyStorageCost = (workspaceUsage as any)?.storageUsed
      ? Math.round((workspaceUsage as any).storageUsed / (1024 * 1024 * 1024) * 0.1 * 100) / 100
      : 0;

    const storageGrowthRateGBPerMonth = 0.5;
    const horizonMultiplier = HORIZON_MULTIPLIERS[horizon];

    const monthlyAiCostPrediction = Math.round(currentMonthlyAiCost * (1 + (horizonMultiplier / 720) * 0.1) * 100) / 100;
    const monthlyExecutionCostPrediction = Math.round(currentMonthlyExecutionCost * (1 + (horizonMultiplier / 720) * 0.05) * 100) / 100;
    const monthlyStorageCostPrediction = Math.round((currentMonthlyStorageCost + storageGrowthRateGBPerMonth * (horizonMultiplier / 720) * 0.1) * 100) / 100;

    const totalMonthlyPrediction = Math.round((monthlyAiCostPrediction + monthlyExecutionCostPrediction + monthlyStorageCostPrediction) * 100) / 100;
    const confidenceScore = this.calculateConfidence(aiUsage[0]?.count || 0, 24);

    return {
      workspaceId: workspaceId.toString(), monthlyAiCostPrediction, monthlyExecutionCostPrediction, monthlyStorageCostPrediction,
      currentMonthlyAiCost, currentMonthlyExecutionCost, currentMonthlyStorageCost, storageGrowthRateGBPerMonth,
      totalMonthlyPrediction, confidenceScore, horizon, modelVersion: MODEL_VERSION, predictedAt: new Date(),
    };
  }

  public async createAlert(input: AlertCreateInput): Promise<IPredictionAlert> {
    const workspaceId = typeof input.workspaceId === 'string' ? new Types.ObjectId(input.workspaceId) : input.workspaceId;
    const alert = await PredictionAlertModel.create({
      workspaceId, type: input.type, severity: input.severity, confidence: input.confidence,
      prediction: input.prediction, recommendation: input.recommendation,
      horizon: input.horizon || '24h', modelVersion: input.modelVersion || MODEL_VERSION,
      featuresUsed: input.featuresUsed || [],
    });
    return alert;
  }

  public async getAlerts(
    workspaceId: Types.ObjectId | string,
    filters: { type?: PredictionType; severity?: IPredictionAlert['severity']; status?: 'active' | 'acknowledged' | 'resolved' | 'dismissed'; startTime?: Date; endTime?: Date } = {}
  ): Promise<IPredictionAlert[]> {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const query: any = { workspaceId: wsId };
    if (filters.type) query.type = filters.type;
    if (filters.severity) query.severity = filters.severity;
    if (filters.status) query.status = filters.status;
    if (filters.startTime || filters.endTime) {
      query.predictedAt = {};
      if (filters.startTime) query.predictedAt.$gte = filters.startTime;
      if (filters.endTime) query.predictedAt.$lte = filters.endTime;
    }
    return PredictionAlertModel.find(query).sort({ predictedAt: -1 }).exec();
  }

  public async acknowledgeAlert(alertId: Types.ObjectId | string, userId: Types.ObjectId | string, note?: string): Promise<IPredictionAlert | null> {
    const id = typeof alertId === 'string' ? new Types.ObjectId(alertId) : alertId;
    const user = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    return PredictionAlertModel.findByIdAndUpdate(id, { status: 'acknowledged', acknowledgedBy: user, acknowledgedAt: new Date(), acknowledgedNote: note || '' }, { new: true }).exec();
  }

  public async resolveAlert(alertId: Types.ObjectId | string, userId: Types.ObjectId | string): Promise<IPredictionAlert | null> {
    const id = typeof alertId === 'string' ? new Types.ObjectId(alertId) : alertId;
    const user = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    return PredictionAlertModel.findByIdAndUpdate(id, { status: 'resolved', resolvedBy: user, resolvedAt: new Date() }, { new: true }).exec();
  }

  public async dismissAlert(alertId: Types.ObjectId | string): Promise<IPredictionAlert | null> {
    const id = typeof alertId === 'string' ? new Types.ObjectId(alertId) : alertId;
    return PredictionAlertModel.findByIdAndUpdate(id, { status: 'dismissed' }, { new: true }).exec();
  }

  public async runFullPredictionCycle(workspaceId: Types.ObjectId | string): Promise<{
    failure: FailurePredictionResult;
    performance: PerformancePredictionResult;
    capacity: CapacityPredictionResult;
    cost: CostPredictionResult;
    alerts: IPredictionAlert[];
  }> {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;

    const [failure, performance, capacity, cost] = await Promise.all([
      this.predictFailureProbability({ workspaceId: wsId }),
      this.predictPerformance({ workspaceId: wsId }),
      this.predictCapacity({ workspaceId: wsId }),
      this.predictCost({ workspaceId: wsId }),
    ]);

    const alerts: IPredictionAlert[] = [];

    if (failure.failureProbability >= 60) {
      const alert = await this.createAlert({
        workspaceId: wsId, type: 'failure',
        severity: failure.riskLevel === 'critical' ? 'critical' : failure.riskLevel === 'high' ? 'high' : 'medium',
        confidence: failure.confidenceScore,
        prediction: { failureProbability: failure.failureProbability, riskyNodes: failure.riskyNodes },
        recommendation: `Review risky nodes: ${failure.riskyNodes.map(n => n.nodeId).join(', ')}`,
        horizon: '24h', modelVersion: MODEL_VERSION, featuresUsed: ['executionHistory', 'nodeFailureRates', 'recentFailures'],
      });
      alerts.push(alert);
    }

    if (performance.latencySpikeRisk === 'high') {
      const alert = await this.createAlert({
        workspaceId: wsId, type: 'performance', severity: 'high', confidence: performance.confidenceScore,
        prediction: { predictedDurationMs: performance.predictedDurationMs, latencySpikeRisk: performance.latencySpikeRisk },
        recommendation: 'Investigate performance bottlenecks and consider scaling resources.',
        horizon: '24h', modelVersion: MODEL_VERSION, featuresUsed: ['executionDurations', 'latencyPercentiles', 'trendAnalysis'],
      });
      alerts.push(alert);
    }

    if (capacity.recommendedWorkerCount > capacity.currentWorkerCount) {
      const alert = await this.createAlert({
        workspaceId: wsId, type: 'capacity', severity: capacity.utilizationRate > 80 ? 'high' : 'medium', confidence: capacity.confidenceScore,
        prediction: { queueDepthPrediction: capacity.queueDepthPrediction, recommendedWorkerCount: capacity.recommendedWorkerCount },
        recommendation: `Scale workers from ${capacity.currentWorkerCount} to ${capacity.recommendedWorkerCount} to handle predicted queue depth.`,
        horizon: '24h', modelVersion: MODEL_VERSION, featuresUsed: ['queueMetrics', 'workerUtilization', 'throughputHistory'],
      });
      alerts.push(alert);
    }

    if (cost.totalMonthlyPrediction > cost.currentMonthlyAiCost + cost.currentMonthlyExecutionCost + cost.currentMonthlyStorageCost) {
      const alert = await this.createAlert({
        workspaceId: wsId, type: 'cost', severity: 'medium', confidence: cost.confidenceScore,
        prediction: { totalMonthlyPrediction: cost.totalMonthlyPrediction, growthRate: cost.storageGrowthRateGBPerMonth },
        recommendation: 'Review AI usage and storage growth to manage costs.',
        horizon: '24h', modelVersion: MODEL_VERSION, featuresUsed: ['aiUsageHistory', 'storageGrowth', 'costTrends'],
      });
      alerts.push(alert);
    }

    return { failure, performance, capacity, cost, alerts };
  }
}
