import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IWorkflowStat {
  workflowId: Types.ObjectId;
  name: string;
  executionCount: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
  lastExecutedAt?: Date;
}

export interface IFailingNodeStat {
  nodeId: string;
  nodeType: string;
  failureCount: number;
  errorSample?: string;
}

export interface IUserActivityStat {
  userId: Types.ObjectId;
  email: string;
  name: string;
  workflowsCreated: number;
  executionsTriggered: number;
  lastActiveAt?: Date;
}

export interface ICostBreakdown {
  executionComputeCost: number;
  aiTokenCost: number;
  storageCost: number;
  totalCost: number;
  currency: string;
}

export interface IPerformancePercentiles {
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgDurationMs: number;
}

export interface IEnterpriseAnalytics extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
  startDate: Date;
  endDate: Date;
  totalWorkflows: number;
  activeWorkflows: number;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  performance: IPerformancePercentiles;
  topWorkflows: IWorkflowStat[];
  mostFailingNodes: IFailingNodeStat[];
  userActivity: IUserActivityStat[];
  cost: ICostBreakdown;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const WorkflowStatSchema = new Schema<IWorkflowStat>(
  {
    workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow', required: true },
    name: { type: String, required: true },
    executionCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    avgDurationMs: { type: Number, default: 0 },
    lastExecutedAt: { type: Date },
  },
  { _id: false }
);

const FailingNodeStatSchema = new Schema<IFailingNodeStat>(
  {
    nodeId: { type: String, required: true },
    nodeType: { type: String, required: true },
    failureCount: { type: Number, default: 0 },
    errorSample: { type: String },
  },
  { _id: false }
);

const UserActivityStatSchema = new Schema<IUserActivityStat>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    email: { type: String, required: true },
    name: { type: String, required: true },
    workflowsCreated: { type: Number, default: 0 },
    executionsTriggered: { type: Number, default: 0 },
    lastActiveAt: { type: Date },
  },
  { _id: false }
);

const CostBreakdownSchema = new Schema<ICostBreakdown>(
  {
    executionComputeCost: { type: Number, default: 0 },
    aiTokenCost: { type: Number, default: 0 },
    storageCost: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
  },
  { _id: false }
);

const PerformancePercentilesSchema = new Schema<IPerformancePercentiles>(
  {
    p50Ms: { type: Number, default: 0 },
    p90Ms: { type: Number, default: 0 },
    p95Ms: { type: Number, default: 0 },
    p99Ms: { type: Number, default: 0 },
    avgDurationMs: { type: Number, default: 0 },
  },
  { _id: false }
);

const EnterpriseAnalyticsSchema = new Schema<IEnterpriseAnalytics>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    period: {
      type: String,
      enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'],
      default: 'DAILY',
      required: true,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalWorkflows: { type: Number, default: 0 },
    activeWorkflows: { type: Number, default: 0 },
    totalExecutions: { type: Number, default: 0 },
    successfulExecutions: { type: Number, default: 0 },
    failedExecutions: { type: Number, default: 0 },
    successRate: { type: Number, default: 100 },
    performance: { type: PerformancePercentilesSchema, default: () => ({}) },
    topWorkflows: { type: [WorkflowStatSchema], default: [] },
    mostFailingNodes: { type: [FailingNodeStatSchema], default: [] },
    userActivity: { type: [UserActivityStatSchema], default: [] },
    cost: { type: CostBreakdownSchema, default: () => ({}) },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true, minimize: false }
);

EnterpriseAnalyticsSchema.index({ workspaceId: 1, startDate: -1, endDate: -1 });
EnterpriseAnalyticsSchema.index({ workspaceId: 1, period: 1 });

export const EnterpriseAnalyticsModel = mongoose.model<IEnterpriseAnalytics>(
  'EnterpriseAnalytics',
  EnterpriseAnalyticsSchema
);
