import { Types } from 'mongoose';
import { PredictiveAnomalyModel, type IPredictiveAnomaly } from '../models/PredictiveAnomalyModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';

export type AnomalyType = 'queue_depth' | 'error_rate' | 'memory_pressure' | 'execution_drift' | 'sla_breach_risk';
export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PredictiveAnomalyInput {
  workspaceId: Types.ObjectId | string;
  workflowId: Types.ObjectId | string;
  executionId: Types.ObjectId | string;
  anomalyType: AnomalyType;
  severity: SeverityLevel;
  confidenceScore: number;
  metrics: Record<string, any>;
  predictedFailureTime: Date;
  recommendedActions: string[];
}

export class PredictiveOperationsService {
  private static instance: PredictiveOperationsService;

  private constructor() {}

  public static getInstance(): PredictiveOperationsService {
    if (!PredictiveOperationsService.instance) {
      PredictiveOperationsService.instance = new PredictiveOperationsService();
    }
    return PredictiveOperationsService.instance;
  }

  /**
   * Create a new predictive anomaly record
   */
  async createAnomaly(input: PredictiveAnomalyInput): Promise<IPredictiveAnomaly> {
    const workspaceId = typeof input.workspaceId === 'string' ? new Types.ObjectId(input.workspaceId) : input.workspaceId;
    const workflowId = typeof input.workflowId === 'string' ? new Types.ObjectId(input.workflowId) : input.workflowId;
    const executionId = typeof input.executionId === 'string' ? new Types.ObjectId(input.executionId) : input.executionId;

    const anomaly = await PredictiveAnomalyModel.create({
      workspaceId,
      workflowId,
      executionId,
      anomalyType: input.anomalyType,
      severity: input.severity,
      confidenceScore: input.confidenceScore,
      metrics: input.metrics,
      predictedFailureTime: input.predictedFailureTime,
      recommendedActions: input.recommendedActions,
      isAcknowledged: false,
    });

    return anomaly;
  }

  /**
   * Get anomalies for a workspace with optional filtering
   */
  async getAnomalies(
    workspaceId: Types.ObjectId | string,
    filters: {
      workflowId?: Types.ObjectId | string | undefined;
      anomalyType?: AnomalyType | undefined;
      severity?: SeverityLevel | undefined;
      isAcknowledged?: boolean | undefined;
      startTime?: Date | undefined;
      endTime?: Date | undefined;
    } = {}
  ): Promise<IPredictiveAnomaly[]> {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const query: any = { workspaceId: wsId };

    if (filters.workflowId) {
      const wfId = typeof filters.workflowId === 'string' ? new Types.ObjectId(filters.workflowId) : filters.workflowId;
      query.workflowId = wfId;
    }

    if (filters.anomalyType) {
      query.anomalyType = filters.anomalyType;
    }

    if (filters.severity) {
      query.severity = filters.severity;
    }

    if (filters.isAcknowledged !== undefined) {
      query.isAcknowledged = filters.isAcknowledged;
    }

    if (filters.startTime || filters.endTime) {
      query.predictedFailureTime = {};
      if (filters.startTime) query.predictedFailureTime.$gte = filters.startTime;
      if (filters.endTime) query.predictedFailureTime.$lte = filters.endTime;
    }

    const anomalies = await PredictiveAnomalyModel.find(query)
      .sort({ predictedFailureTime: 1 })
      .populate('workflowId', 'name')
      .populate('executionId', 'status')
      .exec();

    return anomalies;
  }

  /**
   * Acknowledge an anomaly
   */
  async acknowledgeAnomaly(
    anomalyId: Types.ObjectId | string,
    userId: Types.ObjectId | string
  ): Promise<IPredictiveAnomaly | null> {
    const id = typeof anomalyId === 'string' ? new Types.ObjectId(anomalyId) : anomalyId;
    const user = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const anomaly = await PredictiveAnomalyModel.findByIdAndUpdate(
      id,
      {
        isAcknowledged: true,
        acknowledgedBy: user,
        acknowledgedAt: new Date(),
      },
      { new: true }
    ).exec();

    return anomaly;
  }

  /**
   * Delete an anomaly (typically after resolution)
   */
  async deleteAnomaly(anomalyId: Types.ObjectId | string): Promise<boolean> {
    const id = typeof anomalyId === 'string' ? new Types.ObjectId(anomalyId) : anomalyId;
    const result = await PredictiveAnomalyModel.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  /**
   * Simulate predictive analytics (in a real system, this would use ML models)
   * This is a placeholder for demonstration purposes.
   */
  async simulatePredictiveAnalysis(
    workspaceId: Types.ObjectId | string,
    workflowId: Types.ObjectId | string
  ): Promise<IPredictiveAnomaly[]> {
    // In a real implementation, this would analyze historical data, trends, etc.
    // For now, we return an empty array to avoid false positives.
    return [];
  }
}