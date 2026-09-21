import { Types } from 'mongoose';
import { UsageMeterModel, USAGE_METRICS } from '../models/UsageMeterModel.js';
import type { UsageMetric, MeterAlertState } from '../models/UsageMeterModel.js';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import type { SubscriptionPlan } from '../models/SubscriptionModel.js';
import { PLAN_LIMITS } from '../models/PlanModel.js';
import type { PlanLimits } from '../models/PlanModel.js';
import { WorkspaceUsageModel } from '../models/WorkspaceUsageModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { AIUsageModel } from '../models/AIUsageModel.js';
import { AgentRunModel } from '../models/AgentRunModel.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { createAuditLog } from './auditService.js';
import { notificationService } from './notificationService.js';

export const METER_WARNING_PERCENT = 80;
export const METER_EXCEEDED_PERCENT = 100;

const METRIC_LIMIT_KEYS: Partial<Record<UsageMetric, keyof PlanLimits>> = {
  EXECUTIONS: 'executionsPerMonth',
  STORAGE_BYTES: 'storageBytes',
};
const METRIC_LABELS: Record<UsageMetric, string> = {
  EXECUTIONS: 'Workflow executions',
  AI_TOKENS: 'AI tokens',
  AGENT_RUNS: 'Agent runs',
  STORAGE_BYTES: 'Storage',
  API_REQUESTS: 'API requests',
};

export interface MeterReading {
  metric: UsageMetric;
  value: number;
  limit: number | null;
  percent: number;
  alertState: MeterAlertState;
  overage: boolean;
  periodKey: string;
}

export interface MeterSummary {
  workspaceId: string;
  plan: SubscriptionPlan | null;
  periodKey: string;
  metrics: MeterReading[];
  generatedAt: string;
}

export interface MeterHistory {
  workspaceId: string;
  days: number;
  series: Array<{ metric: UsageMetric; points: Array<{ periodKey: string; value: number }> }>;
}

export interface MeterRecordOptions {
  occurredAt?: Date;
}

export interface MeterSyncOptions {
  now?: Date;
}

export function dayPeriodKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function monthPeriodKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function shiftUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
export class UsageMeteringService {
  async record(
    workspaceId: Types.ObjectId | string,
    metric: UsageMetric,
    quantity: number = 1,
    options: MeterRecordOptions = {},
  ): Promise<MeterReading> {
    if (!(USAGE_METRICS as readonly string[]).includes(metric)) {
      throw new Error('INVALID_REQUEST');
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error('INVALID_REQUEST');
    }
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const occurredAt = options.occurredAt ?? new Date();
    const dayKey = dayPeriodKey(occurredAt);
    const monthKey = monthPeriodKey(occurredAt);

    const plan = await this.getPlanForWorkspace(workspaceIdObj);
    const limit = this.limitFor(metric, plan);

    const previousMonth = await UsageMeterModel.findOne({
      workspaceId: workspaceIdObj,
      metric,
      granularity: 'MONTH',
      periodKey: monthKey,
    });
    const previousState = previousMonth?.alertState ?? 'OK';

    await UsageMeterModel.updateOne(
      { workspaceId: workspaceIdObj, metric, granularity: 'DAY', periodKey: dayKey },
      { $inc: { value: quantity } },
      { upsert: true },
    );

    const monthBucket = await UsageMeterModel.findOneAndUpdate(
      { workspaceId: workspaceIdObj, metric, granularity: 'MONTH', periodKey: monthKey },
      { $inc: { value: quantity } },
      { upsert: true, new: true },
    );

    const reading = this.deriveReading(metric, monthBucket?.value ?? quantity, limit, monthKey);
    await UsageMeterModel.updateOne(
      { workspaceId: workspaceIdObj, metric, granularity: 'MONTH', periodKey: monthKey },
      { $set: { limit, percent: reading.percent, alertState: reading.alertState } },
    );
    await UsageMeterModel.updateOne(
      { workspaceId: workspaceIdObj, metric, granularity: 'DAY', periodKey: dayKey },
      { $set: { limit, percent: reading.percent, alertState: reading.alertState } },
    );

    if (previousState !== reading.alertState) {
      await this.raiseAlert(workspaceIdObj, reading);
    }
    return reading;
  }
  private async raiseAlert(workspaceId: Types.ObjectId, reading: MeterReading): Promise<void> {
    if (reading.alertState === 'OK') return;
    const resourceId = `${reading.metric}:${reading.periodKey}`;
    await createAuditLog({
      action: 'USAGE_QUOTA_ALERT_RAISED',
      workspaceId,
      resource: 'usage_meter',
      resourceId,
      metadata: {
        metric: reading.metric,
        periodKey: reading.periodKey,
        alertState: reading.alertState,
        value: reading.value,
        limit: reading.limit,
        percent: reading.percent,
      },
    });

    const workspace = await WorkspaceModel.findById(workspaceId).select('ownerId name').lean();
    if (!workspace?.ownerId) return;
    const label = METRIC_LABELS[reading.metric];
    const exceeded = reading.alertState === 'EXCEEDED';
    try {
      await notificationService.createNotification({
        userId: workspace.ownerId.toString(),
        workspaceId: workspaceId.toString(),
        type: 'SYSTEM',
        title: exceeded ? `${label} limit exceeded` : `${label} approaching plan limit`,
        message: exceeded
          ? `${label} usage reached ${reading.percent}% of the plan limit (${reading.value} of ${reading.limit}) for ${reading.periodKey}.`
          : `${label} usage crossed ${METER_WARNING_PERCENT}% of the plan limit (${reading.value} of ${reading.limit}) for ${reading.periodKey}.`,
        resourceType: 'usage_meter',
        resourceId,
        metadata: {
          metric: reading.metric,
          periodKey: reading.periodKey,
          alertState: reading.alertState,
          value: reading.value,
          limit: reading.limit,
          percent: reading.percent,
        },
      });
    } catch (error) {
      console.warn('Failed to create usage quota notification', error);
    }
  }
  async syncFromSources(
    workspaceId: Types.ObjectId | string,
    options: MeterSyncOptions = {},
  ): Promise<MeterReading[]> {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const now = options.now ?? new Date();
    const dayKey = dayPeriodKey(now);
    const monthKey = monthPeriodKey(now);
    const dayStart = startOfUtcDay(now);
    const monthStart = startOfUtcMonth(now);
    const plan = await this.getPlanForWorkspace(workspaceIdObj);

    const [
      executionsDay,
      executionsMonth,
      tokensDay,
      tokensMonth,
      agentRunsDay,
      agentRunsMonth,
      usageDoc,
    ] = await Promise.all([
      WorkflowExecutionModel.countDocuments({ workspaceId: workspaceIdObj, createdAt: { $gte: dayStart } }),
      WorkflowExecutionModel.countDocuments({ workspaceId: workspaceIdObj, createdAt: { $gte: monthStart } }),
      this.sumAiTokens(workspaceIdObj, dayStart),
      this.sumAiTokens(workspaceIdObj, monthStart),
      AgentRunModel.countDocuments({ workspaceId: workspaceIdObj, createdAt: { $gte: dayStart } }),
      AgentRunModel.countDocuments({ workspaceId: workspaceIdObj, createdAt: { $gte: monthStart } }),
      WorkspaceUsageModel.findOne({ workspaceId: workspaceIdObj }),
    ]);

    const storageBytes = usageDoc?.storageUsed ?? 0;

    const sources: Array<{ metric: UsageMetric; day: number; month: number }> = [
      { metric: 'EXECUTIONS', day: executionsDay, month: executionsMonth },
      { metric: 'AI_TOKENS', day: tokensDay, month: tokensMonth },
      { metric: 'AGENT_RUNS', day: agentRunsDay, month: agentRunsMonth },
      { metric: 'STORAGE_BYTES', day: storageBytes, month: storageBytes },
    ];

    const readings: MeterReading[] = [];
    for (const source of sources) {
      readings.push(await this.writeBucket(workspaceIdObj, source.metric, 'DAY', dayKey, source.day, plan));
      readings.push(await this.writeBucket(workspaceIdObj, source.metric, 'MONTH', monthKey, source.month, plan));
    }
    return readings;
  }

  private async sumAiTokens(workspaceId: Types.ObjectId, since: Date): Promise<number> {
    const result = await AIUsageModel.aggregate<{ total: number }>([
      { $match: { workspaceId, createdAt: { $gte: since } } },
      { $group: { _id: null, total: { $sum: '$tokensUsed' } } },
    ]);
    return result[0]?.total ?? 0;
  }
  private async writeBucket(
    workspaceId: Types.ObjectId,
    metric: UsageMetric,
    granularity: 'DAY' | 'MONTH',
    periodKey: string,
    value: number,
    plan: SubscriptionPlan | null,
  ): Promise<MeterReading> {
    const limit = this.limitFor(metric, plan);
    const reading = this.deriveReading(metric, value, limit, periodKey);
    const previous = await UsageMeterModel.findOne({ workspaceId, metric, granularity, periodKey });
    const previousState = previous?.alertState ?? 'OK';
    await UsageMeterModel.updateOne(
      { workspaceId, metric, granularity, periodKey },
      {
        $set: {
          value,
          limit,
          percent: reading.percent,
          alertState: reading.alertState,
        },
      },
      { upsert: true },
    );
    if (granularity === 'MONTH' && previousState !== reading.alertState) {
      await this.raiseAlert(workspaceId, reading);
    }
    return reading;
  }
  async getSummary(
    workspaceId: Types.ObjectId | string,
    options: MeterSyncOptions = {},
  ): Promise<MeterSummary> {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const now = options.now ?? new Date();
    const monthKey = monthPeriodKey(now);
    const [plan, buckets] = await Promise.all([
      this.getPlanForWorkspace(workspaceIdObj),
      UsageMeterModel.find({
        workspaceId: workspaceIdObj,
        granularity: 'MONTH',
        periodKey: monthKey,
      }).lean(),
    ]);
    const valueByMetric = new Map<string, number>();
    for (const bucket of buckets) valueByMetric.set(bucket.metric, bucket.value);

    const metrics: MeterReading[] = USAGE_METRICS.map((metric) => {
      const limit = this.limitFor(metric, plan);
      const value = valueByMetric.get(metric) ?? 0;
      return this.deriveReading(metric, value, limit, monthKey);
    });

    return {
      workspaceId: workspaceIdObj.toString(),
      plan,
      periodKey: monthKey,
      metrics,
      generatedAt: now.toISOString(),
    };
  }

  async getHistory(
    workspaceId: Types.ObjectId | string,
    days: number = 30,
    options: MeterSyncOptions = {},
  ): Promise<MeterHistory> {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const safeDays = Number.isFinite(days) && days > 0 ? Math.min(365, Math.floor(days)) : 30;
    const now = options.now ?? new Date();
    const firstKey = dayPeriodKey(shiftUtcDays(now, -(safeDays - 1)));
    const buckets = await UsageMeterModel.find({
      workspaceId: workspaceIdObj,
      granularity: 'DAY',
      periodKey: { $gte: firstKey },
    }).sort({ periodKey: 1 }).lean();

    const series = USAGE_METRICS.map((metric) => ({
      metric,
      points: buckets
        .filter((bucket) => bucket.metric === metric)
        .map((bucket) => ({ periodKey: bucket.periodKey, value: bucket.value })),
    }));

    return { workspaceId: workspaceIdObj.toString(), days: safeDays, series };
  }
  private deriveReading(
    metric: UsageMetric,
    value: number,
    limit: number | null,
    periodKey: string,
  ): MeterReading {
    const hasLimit = typeof limit === 'number' && limit > 0;
    const percent = hasLimit ? Math.round((value / limit) * 1000) / 10 : 0;
    const alertState: MeterAlertState = !hasLimit
      ? 'OK'
      : percent >= METER_EXCEEDED_PERCENT
        ? 'EXCEEDED'
        : percent >= METER_WARNING_PERCENT
          ? 'WARNING'
          : 'OK';
    return {
      metric,
      value,
      limit,
      percent,
      alertState,
      overage: hasLimit ? value > limit : false,
      periodKey,
    };
  }

  private limitFor(metric: UsageMetric, plan: SubscriptionPlan | null): number | null {
    const limitKey = METRIC_LIMIT_KEYS[metric];
    if (!limitKey || !plan) return null;
    return PLAN_LIMITS[plan][limitKey] ?? null;
  }

  private async getPlanForWorkspace(workspaceId: Types.ObjectId): Promise<SubscriptionPlan | null> {
    const subscription = await SubscriptionModel.findOne({ workspaceId }).select('plan').lean();
    return (subscription?.plan as SubscriptionPlan | undefined) ?? null;
  }
}

export const usageMeteringService = new UsageMeteringService();
