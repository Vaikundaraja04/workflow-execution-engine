import { Types } from 'mongoose';
import { TenantAccountModel } from '../models/TenantAccountModel.js';
import type { TenantStatus } from '../models/TenantAccountModel.js';
import { CustomerProfileModel } from '../models/CustomerProfileModel.js';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import type { SubscriptionPlan, SubscriptionStatus } from '../models/SubscriptionModel.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../models/WorkspaceMemberModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { AgentModel } from '../models/AgentModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { UsageMeterModel } from '../models/UsageMeterModel.js';
import { monthPeriodKey } from './usageMeteringService.js';
import { productPackagingService } from './productPackagingService.js';
import { createAuditLog } from './auditService.js';

/**
 * Phase 14.8 - Customer Success Foundation.
 *
 * Turns existing telemetry (executions, AI usage, metering, membership, support
 * notes) into a health score, risk indicators and the retention actions a CSM
 * should take. Read-only: it never mutates tenant data.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type HealthBand = 'healthy' | 'watch' | 'at_risk';
export type RiskCode =
  | 'TENANT_SUSPENDED'
  | 'SUBSCRIPTION_INACTIVE'
  | 'PAYMENT_AT_RISK'
  | 'TRIAL_ENDING'
  | 'HIGH_FAILURE_RATE'
  | 'NO_RECENT_ACTIVITY'
  | 'QUOTA_EXCEEDED'
  | 'USAGE_NEAR_LIMIT'
  | 'SUPPORT_ESCALATION'
  | 'LOW_ADOPTION';

export interface HealthFactor {
  name: 'activeUsage' | 'reliability' | 'aiUsage' | 'adoption' | 'support';
  label: string;
  weight: number;
  score: number;
  detail: string;
}

export interface HealthRisk {
  code: RiskCode;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
}

export interface HealthRecommendation {
  code: string;
  action: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  owner: 'CSM' | 'SUPPORT' | 'SALES' | 'PLATFORM';
}

export interface CustomerHealthSignals {
  executions30d: number;
  executionsPrev30d: number;
  executionTrendPercent: number;
  failedExecutions30d: number;
  failureRatePercent: number;
  aiTokensThisMonth: number;
  aiTokenLimit: number | null;
  aiUtilizationPercent: number | null;
  workflows: number;
  publishedWorkflows: number;
  activeAgents: number;
  members: number;
  supportNotes30d: number;
  lastActivityAt: Date | null;
  idleDays: number | null;
  usagePressurePercent: number;
  trialEndsAt: Date | null;
  trialDaysRemaining: number | null;
}

export interface CustomerHealthReport {
  workspaceId: string;
  companyName: string;
  plan: SubscriptionPlan | null;
  packageId: string | null;
  packageName: string | null;
  tenantStatus: TenantStatus | null;
  subscriptionStatus: SubscriptionStatus | null;
  score: number;
  band: HealthBand;
  factors: HealthFactor[];
  risks: HealthRisk[];
  recommendations: HealthRecommendation[];
  signals: CustomerHealthSignals;
  generatedAt: string;
}

export interface HealthPortfolio {
  customers: CustomerHealthReport[];
  summary: {
    total: number;
    healthy: number;
    watch: number;
    atRisk: number;
    averageScore: number;
    riskCounts: Array<{ code: RiskCode; count: number }>;
  };
}

const FACTOR_WEIGHTS: Record<HealthFactor['name'], number> = {
  activeUsage: 0.25,
  reliability: 0.25,
  aiUsage: 0.15,
  adoption: 0.2,
  support: 0.15,
};

export const HEALTH_FACTOR_WEIGHTS = FACTOR_WEIGHTS;

export function bandForScore(score: number): HealthBand {
  return score >= 70 ? 'healthy' : score >= 40 ? 'watch' : 'at_risk';
}

export class CustomerHealthService {
  /** Score one workspace: factors, risks and recommended actions. */
  async evaluate(
    workspaceId: Types.ObjectId | string,
    options: { now?: Date; actorUserId?: string } = {},
  ): Promise<CustomerHealthReport> {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const now = options.now ?? new Date();
    const since30d = new Date(now.getTime() - 30 * DAY_MS);
    const since60d = new Date(now.getTime() - 60 * DAY_MS);
    const monthKey = monthPeriodKey(now);

    const [workspace, tenant, profile, subscription] = await Promise.all([
      WorkspaceModel.findById(workspaceIdObj).select('name status').lean(),
      TenantAccountModel.findOne({ workspaceId: workspaceIdObj }).lean(),
      CustomerProfileModel.findOne({ tenantId: workspaceIdObj }).lean(),
      SubscriptionModel.findOne({ workspaceId: workspaceIdObj }).lean(),
    ]);
    if (!workspace && !tenant) throw new Error('CUSTOMER_NOT_FOUND');

    const plan = (subscription?.plan as SubscriptionPlan | undefined) ?? (tenant?.plan as SubscriptionPlan | undefined) ?? null;
    const packageId = plan ? productPackagingService.packageForPlan(plan) : null;
    const packaged = packageId
      ? await productPackagingService.getProductPlan(packageId).catch(() => null)
      : null;

    const [
      executions30d,
      executionsPrev30d,
      failedExecutions30d,
      workflows,
      publishedWorkflows,
      activeAgents,
      members,
      lastExecution,
      aiBucket,
    ] = await Promise.all([
      WorkflowExecutionModel.countDocuments({ workspaceId: workspaceIdObj, createdAt: { $gte: since30d, $lte: now } }),
      WorkflowExecutionModel.countDocuments({
        workspaceId: workspaceIdObj,
        createdAt: { $gte: since60d, $lt: since30d },
      }),
      WorkflowExecutionModel.countDocuments({
        workspaceId: workspaceIdObj,
        status: 'FAILED',
        createdAt: { $gte: since30d, $lte: now },
      }),
      WorkflowModel.countDocuments({ workspaceId: workspaceIdObj }),
      WorkflowModel.countDocuments({ workspaceId: workspaceIdObj, status: 'PUBLISHED' }),
      AgentModel.countDocuments({ workspaceId: workspaceIdObj, status: 'ACTIVE' }),
      WorkspaceMemberModel.countDocuments({ workspaceId: workspaceIdObj, status: 'ACTIVE' }),
      WorkflowExecutionModel.findOne({ workspaceId: workspaceIdObj }).sort({ createdAt: -1 }).select('createdAt').lean(),
      UsageMeterModel.findOne({ workspaceId: workspaceIdObj, metric: 'AI_TOKENS', granularity: 'MONTH', periodKey: monthKey })
        .select('value limit percent')
        .lean(),
    ]);

    const supportNotes = profile?.supportNotes ?? [];
    const supportNotes30d = supportNotes.filter((note) => note.createdAt >= since30d).length;

    const lastActivityCandidates = [
      lastExecution?.createdAt ?? null,
      workspace?.updatedAt ?? null,
    ].filter((value): value is Date => value instanceof Date);
    const lastActivityAt = lastActivityCandidates.length > 0
      ? new Date(Math.max(...lastActivityCandidates.map((value) => value.getTime())))
      : null;
    const idleDays = lastActivityAt ? Math.floor((now.getTime() - lastActivityAt.getTime()) / DAY_MS) : null;

    const failureRatePercent = executions30d > 0
      ? Math.round((failedExecutions30d / executions30d) * 1000) / 10
      : 0;
    const executionTrendPercent = executionsPrev30d > 0
      ? Math.round(((executions30d - executionsPrev30d) / executionsPrev30d) * 1000) / 10
      : executions30d > 0
        ? 100
        : 0;

    const aiTokenLimit = packaged?.packaging.aiRequestLimit ?? null;
    const aiTokensThisMonth = aiBucket?.value ?? 0;
    const aiUtilizationPercent = typeof aiTokenLimit === 'number' && aiTokenLimit > 0
      ? Math.round((aiTokensThisMonth / aiTokenLimit) * 1000) / 10
      : null;

    const usagePressurePercent = Math.max(
      aiUtilizationPercent ?? 0,
      aiBucket?.percent ?? 0,
    );

    const trialEndsAt = tenant?.trialEndsAt ?? subscription?.trialEndsAt ?? null;
    const trialDaysRemaining = trialEndsAt
      ? Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS)
      : null;

    const signals: CustomerHealthSignals = {
      executions30d,
      executionsPrev30d,
      executionTrendPercent,
      failedExecutions30d,
      failureRatePercent,
      aiTokensThisMonth,
      aiTokenLimit,
      aiUtilizationPercent,
      workflows,
      publishedWorkflows,
      activeAgents,
      members,
      supportNotes30d,
      lastActivityAt,
      idleDays,
      usagePressurePercent,
      trialEndsAt,
      trialDaysRemaining,
    };

    const factors = this.factorsFor(signals);
    const score = Math.round(factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0));
    const risks = this.risksFor(signals, tenant?.status ?? null, subscription?.status ?? null);
    const report: CustomerHealthReport = {
      workspaceId: workspaceIdObj.toString(),
      companyName: tenant?.companyName ?? workspace?.name ?? 'Unknown customer',
      plan,
      packageId,
      packageName: packaged?.name ?? null,
      tenantStatus: tenant?.status ?? null,
      subscriptionStatus: (subscription?.status as SubscriptionStatus | undefined) ?? null,
      score,
      band: bandForScore(score),
      factors,
      risks,
      recommendations: this.recommendationsFor(signals, risks, score >= 70),
      signals,
      generatedAt: new Date().toISOString(),
    };

    if (options.actorUserId) {
      await createAuditLog({
        action: 'CUSTOMER_HEALTH_EVALUATED',
        userId: options.actorUserId,
        workspaceId: workspaceIdObj,
        resource: 'customer_health',
        resourceId: workspaceIdObj.toString(),
        metadata: { score: report.score, band: report.band, risks: report.risks.map((risk) => risk.code) },
      });
    }

    return report;
  }

  /** Weighted factors behind the score. */
  private factorsFor(signals: CustomerHealthSignals): HealthFactor[] {
    const usageScore = signals.executions30d === 0
      ? 0
      : signals.executionTrendPercent >= 0
        ? Math.min(100, 70 + Math.min(30, signals.executionTrendPercent / 2))
        : Math.max(20, 70 + signals.executionTrendPercent / 2);

    const reliabilityScore = signals.executions30d === 0
      ? 50
      : signals.failureRatePercent <= 2
        ? 100
        : signals.failureRatePercent <= 10
          ? 70
          : signals.failureRatePercent <= 25
            ? 40
            : 10;

    const aiScore = signals.aiUtilizationPercent === null
      ? 50
      : signals.aiUtilizationPercent >= 100
        ? 30
        : signals.aiUtilizationPercent >= 80
          ? 70
          : signals.aiUtilizationPercent >= 5
            ? 100
            : 60;

    const adoptionRaw = signals.publishedWorkflows * 12 + signals.activeAgents * 8 + signals.members * 4;
    const adoptionScore = Math.max(0, Math.min(100, adoptionRaw));

    const supportScore = signals.supportNotes30d === 0
      ? 100
      : signals.supportNotes30d <= 2
        ? 70
        : signals.supportNotes30d <= 5
          ? 40
          : 15;

    return [
      {
        name: 'activeUsage',
        label: 'Active usage',
        weight: FACTOR_WEIGHTS.activeUsage,
        score: Math.round(usageScore),
        detail: `${signals.executions30d} executions in 30 days (${signals.executionTrendPercent}% vs prior 30 days)`,
      },
      {
        name: 'reliability',
        label: 'Execution reliability',
        weight: FACTOR_WEIGHTS.reliability,
        score: reliabilityScore,
        detail: `${signals.failedExecutions30d} failures (${signals.failureRatePercent}% failure rate)`,
      },
      {
        name: 'aiUsage',
        label: 'AI adoption',
        weight: FACTOR_WEIGHTS.aiUsage,
        score: aiScore,
        detail: signals.aiUtilizationPercent === null
          ? 'No AI token limit on this package'
          : `${signals.aiUtilizationPercent}% of the AI token allowance used this month`,
      },
      {
        name: 'adoption',
        label: 'Platform adoption',
        weight: FACTOR_WEIGHTS.adoption,
        score: adoptionScore,
        detail: `${signals.publishedWorkflows} published workflows, ${signals.activeAgents} active agents, ${signals.members} members`,
      },
      {
        name: 'support',
        label: 'Support load',
        weight: FACTOR_WEIGHTS.support,
        score: supportScore,
        detail: `${signals.supportNotes30d} support notes in the last 30 days`,
      },
    ];
  }

  /** Risk indicators derived from the signals. */
  private risksFor(
    signals: CustomerHealthSignals,
    tenantStatus: TenantStatus | null,
    subscriptionStatus: SubscriptionStatus | null,
  ): HealthRisk[] {
    const risks: HealthRisk[] = [];

    if (tenantStatus === 'SUSPENDED' || tenantStatus === 'CLOSED') {
      risks.push({
        code: 'TENANT_SUSPENDED',
        severity: 'HIGH',
        message: `Tenant is ${tenantStatus.toLowerCase()} - workspace APIs are blocked`,
      });
    }
    if (subscriptionStatus === 'CANCELLED' || subscriptionStatus === 'EXPIRED') {
      risks.push({
        code: 'SUBSCRIPTION_INACTIVE',
        severity: 'HIGH',
        message: `Subscription is ${subscriptionStatus.toLowerCase()} - entitlements have fallen back to FREE limits`,
      });
    } else if (subscriptionStatus === 'PAST_DUE') {
      risks.push({
        code: 'PAYMENT_AT_RISK',
        severity: 'HIGH',
        message: 'Subscription is past due - contact billing before the grace window closes',
      });
    }
    if (signals.trialDaysRemaining !== null && signals.trialDaysRemaining <= 7) {
      risks.push({
        code: 'TRIAL_ENDING',
        severity: signals.trialDaysRemaining <= 2 ? 'HIGH' : 'MEDIUM',
        message: signals.trialDaysRemaining >= 0
          ? `Trial ends in ${signals.trialDaysRemaining} day(s) - confirm conversion or extend`
          : `Trial expired ${Math.abs(signals.trialDaysRemaining)} day(s) ago`,
      });
    }
    if (signals.executions30d > 0 && signals.failureRatePercent > 25) {
      risks.push({
        code: 'HIGH_FAILURE_RATE',
        severity: 'HIGH',
        message: `${signals.failureRatePercent}% of executions failed in the last 30 days`,
      });
    }
    if (signals.idleDays !== null && signals.idleDays > 14) {
      risks.push({
        code: 'NO_RECENT_ACTIVITY',
        severity: signals.idleDays > 30 ? 'HIGH' : 'MEDIUM',
        message: `No execution activity for ${signals.idleDays} days`,
      });
    }
    if (signals.usagePressurePercent >= 100) {
      risks.push({
        code: 'QUOTA_EXCEEDED',
        severity: 'HIGH',
        message: 'A metered quota is exceeded - upgrades or add-ons are required to keep running',
      });
    } else if (signals.usagePressurePercent >= 80) {
      risks.push({
        code: 'USAGE_NEAR_LIMIT',
        severity: 'MEDIUM',
        message: 'A metered quota is above 80% - propose an upgrade before it blocks production',
      });
    }
    if (signals.supportNotes30d >= 3) {
      risks.push({
        code: 'SUPPORT_ESCALATION',
        severity: 'MEDIUM',
        message: `${signals.supportNotes30d} support notes in 30 days - recurring issues or friction`,
      });
    }
    if (signals.executions30d > 0 && signals.publishedWorkflows <= 1 && signals.activeAgents === 0) {
      risks.push({
        code: 'LOW_ADOPTION',
        severity: 'LOW',
        message: 'Usage is concentrated in a single workflow - expansion opportunity is unrealised',
      });
    }

    return risks;
  }

  /** Retention / expansion actions derived from risks and the score. */
  private recommendationsFor(
    signals: CustomerHealthSignals,
    risks: HealthRisk[],
    healthy: boolean,
  ): HealthRecommendation[] {
    const codes = new Set(risks.map((risk) => risk.code));
    const recommendations: HealthRecommendation[] = [];

    if (codes.has('TENANT_SUSPENDED')) {
      recommendations.push({
        code: 'REINSTATE_TENANT',
        action: 'Review the suspension reason and reactivate the tenant or close the account',
        priority: 'HIGH',
        owner: 'SUPPORT',
      });
    }
    if (codes.has('SUBSCRIPTION_INACTIVE') || codes.has('PAYMENT_AT_RISK')) {
      recommendations.push({
        code: 'RECOVER_SUBSCRIPTION',
        action: 'Contact billing, confirm the payment method and restart the subscription before data is archived',
        priority: 'HIGH',
        owner: 'CSM',
      });
    }
    if (codes.has('TRIAL_ENDING')) {
      recommendations.push({
        code: 'CONVERT_TRIAL',
        action: `Book the conversion call: the trial ends in ${signals.trialDaysRemaining} day(s)`,
        priority: 'HIGH',
        owner: 'SALES',
      });
    }
    if (codes.has('HIGH_FAILURE_RATE')) {
      recommendations.push({
        code: 'REVIEW_FAILURES',
        action: 'Open the failure analysis for the failing workflows and enable self-healing policies',
        priority: 'HIGH',
        owner: 'SUPPORT',
      });
    }
    if (codes.has('QUOTA_EXCEEDED') || codes.has('USAGE_NEAR_LIMIT')) {
      recommendations.push({
        code: 'PROPOSE_UPGRADE',
        action: 'Propose the next package or an add-on before the quota blocks production',
        priority: codes.has('QUOTA_EXCEEDED') ? 'HIGH' : 'MEDIUM',
        owner: 'SALES',
      });
    }
    if (codes.has('NO_RECENT_ACTIVITY')) {
      recommendations.push({
        code: 'REENGAGE',
        action: `Re-engage: no execution activity for ${signals.idleDays} day(s) - run a value review`,
        priority: 'MEDIUM',
        owner: 'CSM',
      });
    }
    if (codes.has('SUPPORT_ESCALATION')) {
      recommendations.push({
        code: 'ESCALATE_SUPPORT',
        action: 'Escalate the recurring support theme to the product team',
        priority: 'MEDIUM',
        owner: 'SUPPORT',
      });
    }
    if (codes.has('LOW_ADOPTION') || (healthy && signals.activeAgents === 0)) {
      recommendations.push({
        code: 'EXPAND_ADOPTION',
        action: 'Run an adoption workshop: package more workflows and introduce AI agents',
        priority: 'LOW',
        owner: 'CSM',
      });
    }
    if (recommendations.length === 0) {
      recommendations.push({
        code: 'EXPAND_ADVOCACY',
        action: 'Healthy account - ask for a reference story and explore the next package',
        priority: 'LOW',
        owner: 'CSM',
      });
    }

    return recommendations;
  }

  /**
   * Score a set of tenants for the customer success console.
   * One aggregation per customer keeps the read path simple; callers page it.
   */
  async portfolio(
    options: {
      limit?: number;
      now?: Date;
      band?: HealthBand | undefined;
      tenantStatus?: TenantStatus | undefined;
      demo?: boolean | undefined;
      actorUserId?: string | undefined;
    } = {},
  ): Promise<HealthPortfolio> {
    const limit = Number.isFinite(options.limit) && options.limit && options.limit > 0
      ? Math.min(200, Math.floor(options.limit))
      : 50;
    const query: Record<string, unknown> = {};
    if (options.tenantStatus) query.status = options.tenantStatus;
    if (options.demo !== undefined) query.demo = options.demo;

    const tenants = await TenantAccountModel.find(query)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .select('workspaceId')
      .lean();

    const customers: CustomerHealthReport[] = [];
    for (const tenant of tenants) {
      try {
        const report = await this.evaluate(tenant.workspaceId, options.now ? { now: options.now } : {});
        customers.push(report);
      } catch {
        // A tenant without workspace telemetry is skipped rather than failing the page.
      }
    }

    const filtered = options.band
      ? customers.filter((customer) => customer.band === options.band)
      : customers;
    const riskCounts = new Map<RiskCode, number>();
    for (const customer of filtered) {
      for (const risk of customer.risks) {
        riskCounts.set(risk.code, (riskCounts.get(risk.code) ?? 0) + 1);
      }
    }

    const portfolio: HealthPortfolio = {
      customers: filtered,
      summary: {
        total: filtered.length,
        healthy: filtered.filter((customer) => customer.band === 'healthy').length,
        watch: filtered.filter((customer) => customer.band === 'watch').length,
        atRisk: filtered.filter((customer) => customer.band === 'at_risk').length,
        averageScore: filtered.length > 0
          ? Math.round(filtered.reduce((sum, customer) => sum + customer.score, 0) / filtered.length)
          : 0,
        riskCounts: [...riskCounts.entries()]
          .map(([code, count]) => ({ code, count }))
          .sort((a, b) => b.count - a.count),
      },
    };

    if (options.actorUserId) {
      await createAuditLog({
        action: 'CUSTOMER_HEALTH_EVALUATED',
        userId: options.actorUserId,
        resource: 'customer_health',
        resourceId: 'portfolio',
        metadata: {
          scanned: tenants.length,
          returned: portfolio.customers.length,
          atRisk: portfolio.summary.atRisk,
          averageScore: portfolio.summary.averageScore,
        },
      });
    }

    return portfolio;
  }
}

export const customerHealthService = new CustomerHealthService();


