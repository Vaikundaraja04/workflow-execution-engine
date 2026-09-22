import { Types } from 'mongoose';
import { WorkspaceMemberModel } from '../models/WorkspaceMemberModel.js';
import { WebhookModel } from '../models/WebhookModel.js';
import { APIKeyModel } from '../models/APIKeyModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { customerHealthService, bandForScore } from './customerHealthService.js';
import type {
  CustomerHealthReport,
  HealthBand,
  HealthRecommendation,
  HealthRisk,
} from './customerHealthService.js';

/**
 * Phase 16.4 - Customer success platform.
 *
 * Composes the Phase 14.8 health score (usage, reliability, AI, adoption,
 * support) with the success-specific signals a CSM acts on: active users,
 * feature adoption and failing workflows. The score is calculated in exactly
 * one place - this service only adds context and the customer-facing category
 * names (Healthy / At Risk / Critical).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ACTIVE_USER_DAYS = 30;
const MAX_FAILING_WORKFLOWS = 5;
const DEFAULT_PORTFOLIO_LIMIT = 50;
const MAX_PORTFOLIO_LIMIT = 200;

export type SuccessCategory = 'Healthy' | 'At Risk' | 'Critical';

export function categoryForScore(score: number): SuccessCategory {
  const band = bandForScore(score);
  return band === 'healthy' ? 'Healthy' : band === 'watch' ? 'At Risk' : 'Critical';
}

export interface FeatureAdoption {
  feature: string;
  adopted: boolean;
  detail: string;
}

export interface CustomerSuccessReport {
  workspaceId: string;
  companyName: string;
  plan: string | null;
  packageId: string | null;
  packageName: string | null;
  tenantStatus: string | null;
  subscriptionStatus: string | null;
  score: number;
  band: HealthBand;
  category: SuccessCategory;
  adoption: {
    activeUsers: number;
    totalMembers: number;
    activeUserPercent: number;
    adoptedFeatureCount: number;
    totalFeatureCount: number;
    features: FeatureAdoption[];
  };
  operations: {
    executions30d: number;
    failedExecutions30d: number;
    failureRatePercent: number;
    topFailingWorkflows: Array<{ workflowId: string; name: string; failures: number }>;
  };
  aiUsage: {
    tokensThisMonth: number;
    tokenLimit: number | null;
    utilizationPercent: number | null;
  };
  risks: HealthRisk[];
  recommendations: HealthRecommendation[];
  generatedAt: string;
}

export interface CustomerSuccessPortfolio {
  customers: CustomerSuccessReport[];
  summary: {
    total: number;
    healthy: number;
    atRisk: number;
    critical: number;
    averageScore: number;
    averageActiveUserPercent: number;
    failingWorkflows: number;
  };
  generatedAt: string;
}

interface Enrichment {
  activeUsers: number;
  totalMembers: number;
  webhooks: number;
  apiKeys: number;
  failingWorkflows: Array<{ workflowId: string; name: string; failures: number }>;
}

function emptyEnrichment(): Enrichment {
  return {
    activeUsers: 0,
    totalMembers: 0,
    webhooks: 0,
    apiKeys: 0,
    failingWorkflows: [],
  };
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export class CustomerSuccessService {
  /** Success view of one workspace (tenant-isolated callers resolve their own id). */
  async evaluate(
    workspaceId: Types.ObjectId | string,
    options: { now?: Date | undefined; actorUserId?: string | undefined } = {},
  ): Promise<CustomerSuccessReport> {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const now = options.now ?? new Date();
    const health = await customerHealthService.evaluate(workspaceIdObj, {
      now,
      ...(options.actorUserId !== undefined ? { actorUserId: options.actorUserId } : {}),
    });
    const enrichment = await this.enrichmentFor([workspaceIdObj], now);
    return this.compose(health, enrichment.get(workspaceIdObj.toString()) ?? emptyEnrichment(), now);
  }

  /** Customer success portfolio across tenants. */
  async portfolio(
    options: {
      limit?: number | undefined;
      category?: SuccessCategory | undefined;
      tenantStatus?: 'TRIALING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED' | undefined;
      demo?: boolean | undefined;
      now?: Date | undefined;
      actorUserId?: string | undefined;
    } = {},
  ): Promise<CustomerSuccessPortfolio> {
    const limit = Number.isFinite(options.limit) && options.limit && options.limit > 0
      ? Math.min(MAX_PORTFOLIO_LIMIT, Math.floor(options.limit))
      : DEFAULT_PORTFOLIO_LIMIT;
    const now = options.now ?? new Date();

    const healthPortfolio = await customerHealthService.portfolio({
      limit,
      now,
      ...(options.tenantStatus !== undefined ? { tenantStatus: options.tenantStatus } : {}),
      ...(options.demo !== undefined ? { demo: options.demo } : {}),
      ...(options.actorUserId !== undefined ? { actorUserId: options.actorUserId } : {}),
    });

    const workspaceIds = healthPortfolio.customers
      .map((customer) => customer.workspaceId)
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    const enrichment = await this.enrichmentFor(workspaceIds, now);

    let customers = healthPortfolio.customers.map((customer) =>
      this.compose(
        customer,
        enrichment.get(customer.workspaceId) ?? emptyEnrichment(),
        now,
      ));
    if (options.category) {
      customers = customers.filter((customer) => customer.category === options.category);
    }

    return {
      customers,
      summary: {
        total: customers.length,
        healthy: customers.filter((customer) => customer.category === 'Healthy').length,
        atRisk: customers.filter((customer) => customer.category === 'At Risk').length,
        critical: customers.filter((customer) => customer.category === 'Critical').length,
        averageScore: customers.length > 0
          ? Math.round(customers.reduce((sum, customer) => sum + customer.score, 0) / customers.length)
          : 0,
        averageActiveUserPercent: customers.length > 0
          ? Math.round(customers.reduce((sum, customer) => sum + customer.adoption.activeUserPercent, 0) / customers.length)
          : 0,
        failingWorkflows: customers.reduce(
          (sum, customer) => sum + customer.operations.topFailingWorkflows.length,
          0,
        ),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /** Batched success enrichment: five aggregations for the whole portfolio. */
  private async enrichmentFor(workspaceIds: Types.ObjectId[], now: Date): Promise<Map<string, Enrichment>> {
    const result = new Map<string, Enrichment>();
    if (workspaceIds.length === 0) return result;
    const since = new Date(now.getTime() - ACTIVE_USER_DAYS * MS_PER_DAY);

    const [activeRows, memberRows, webhookRows, apiKeyRows, failureRows] = await Promise.all([
      WorkspaceMemberModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { workspaceId: { $in: workspaceIds }, status: 'ACTIVE', lastActiveAt: { $gte: since } } },
        { $group: { _id: '$workspaceId', count: { $sum: 1 } } },
      ]),
      WorkspaceMemberModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { workspaceId: { $in: workspaceIds }, status: 'ACTIVE' } },
        { $group: { _id: '$workspaceId', count: { $sum: 1 } } },
      ]),
      WebhookModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { workspaceId: { $in: workspaceIds } } },
        { $group: { _id: '$workspaceId', count: { $sum: 1 } } },
      ]),
      APIKeyModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { workspaceId: { $in: workspaceIds }, status: 'ACTIVE' } },
        { $group: { _id: '$workspaceId', count: { $sum: 1 } } },
      ]),
      WorkflowExecutionModel.aggregate<{
        _id: { workspaceId: Types.ObjectId; workflowId: Types.ObjectId };
        failures: number;
      }>([
        { $match: { workspaceId: { $in: workspaceIds }, status: 'FAILED', createdAt: { $gte: since } } },
        { $group: { _id: { workspaceId: '$workspaceId', workflowId: '$workflowId' }, failures: { $sum: 1 } } },
        { $sort: { failures: -1 } },
        { $limit: workspaceIds.length * MAX_FAILING_WORKFLOWS },
      ]),
    ]);

    const failureDetails: Array<{ workspaceId: string; workflowId: string; failures: number }> = [];
    const workflowIds = new Set<string>();
    for (const row of failureRows) {
      const workspaceKey = row._id.workspaceId.toString();
      const workflowKey = row._id.workflowId.toString();
      failureDetails.push({ workspaceId: workspaceKey, workflowId: workflowKey, failures: row.failures });
      workflowIds.add(workflowKey);
    }
    const nameRows = workflowIds.size === 0
      ? []
      : await WorkflowModel.find({ _id: { $in: [...workflowIds].map((id) => new Types.ObjectId(id)) } })
        .select('name')
        .lean();
    const nameById = new Map(nameRows.map((row) => [row._id.toString(), row.name as string]));

    for (const workspaceId of workspaceIds) {
      const key = workspaceId.toString();
      result.set(key, {
        ...emptyEnrichment(),
        activeUsers: activeRows.find((row) => row._id.toString() === key)?.count ?? 0,
        totalMembers: memberRows.find((row) => row._id.toString() === key)?.count ?? 0,
        webhooks: webhookRows.find((row) => row._id.toString() === key)?.count ?? 0,
        apiKeys: apiKeyRows.find((row) => row._id.toString() === key)?.count ?? 0,
      });
    }

    const workspaceKeySet = new Set(workspaceIds.map((id) => id.toString()));
    for (const failure of failureDetails) {
      if (!workspaceKeySet.has(failure.workspaceId)) continue;
      const entry = result.get(failure.workspaceId);
      if (!entry) continue;
      if (entry.failingWorkflows.length >= MAX_FAILING_WORKFLOWS) continue;
      entry.failingWorkflows.push({
        workflowId: failure.workflowId,
        name: nameById.get(failure.workflowId) ?? 'Deleted workflow',
        failures: failure.failures,
      });
    }

    return result;
  }

  /** Compose the health report with the success enrichment. */
  private compose(health: CustomerHealthReport, enrichment: Enrichment, now: Date): CustomerSuccessReport {
    const signals = health.signals;
    const features: FeatureAdoption[] = [
      {
        feature: 'Workflows published',
        adopted: signals.publishedWorkflows > 0,
        detail: `${signals.publishedWorkflows} published of ${signals.workflows} authored`,
      },
      {
        feature: 'AI agents',
        adopted: signals.activeAgents > 0,
        detail: `${signals.activeAgents} active agent(s)`,
      },
      {
        feature: 'AI requests',
        adopted: signals.aiTokensThisMonth > 0,
        detail: `${signals.aiTokensThisMonth.toLocaleString()} tokens this month`,
      },
      {
        feature: 'API access',
        adopted: enrichment.apiKeys > 0,
        detail: `${enrichment.apiKeys} active API key(s)`,
      },
      {
        feature: 'Webhooks',
        adopted: enrichment.webhooks > 0,
        detail: `${enrichment.webhooks} webhook(s) configured`,
      },
    ];
    const adoptedFeatureCount = features.filter((feature) => feature.adopted).length;

    return {
      workspaceId: health.workspaceId,
      companyName: health.companyName,
      plan: health.plan,
      packageId: health.packageId,
      packageName: health.packageName,
      tenantStatus: health.tenantStatus,
      subscriptionStatus: health.subscriptionStatus,
      score: health.score,
      band: health.band,
      category: categoryForScore(health.score),
      adoption: {
        activeUsers: enrichment.activeUsers,
        totalMembers: enrichment.totalMembers,
        activeUserPercent: percent(enrichment.activeUsers, enrichment.totalMembers),
        adoptedFeatureCount,
        totalFeatureCount: features.length,
        features,
      },
      operations: {
        executions30d: signals.executions30d,
        failedExecutions30d: signals.failedExecutions30d,
        failureRatePercent: signals.failureRatePercent,
        topFailingWorkflows: enrichment.failingWorkflows,
      },
      aiUsage: {
        tokensThisMonth: signals.aiTokensThisMonth,
        tokenLimit: signals.aiTokenLimit,
        utilizationPercent: signals.aiUtilizationPercent,
      },
      risks: health.risks,
      recommendations: health.recommendations,
      generatedAt: now.toISOString(),
    };
  }
}

export const customerSuccessService = new CustomerSuccessService();
