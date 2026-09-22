import { Types } from 'mongoose';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { WorkspaceUsageModel } from '../models/WorkspaceUsageModel.js';
import { customerSuccessService } from './customerSuccessService.js';
import { accountManagementService } from './accountManagementService.js';
import type { EnterpriseAccountView } from './accountManagementService.js';
import { slaMonitoringService } from './slaMonitoringService.js';

/**
 * Phase 18.2 - Customer success intelligence.
 *
 * One score per workspace from what is recorded: usage, workflow success rate,
 * AI adoption, team activity and support pressure. The Phase 16.4 success report
 * supplies adoption, AI usage and execution operations - this service adds the
 * usage record, the support signal and the operator-facing status, and never
 * recomputes a number another service owns.
 */

export const SUCCESS_HEALTHY_THRESHOLD = 70;
export const SUCCESS_WARNING_THRESHOLD = 40;

export type SuccessIntelligenceStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL';

export function intelligenceStatusForScore(score: number): SuccessIntelligenceStatus {
  if (score >= SUCCESS_HEALTHY_THRESHOLD) return 'HEALTHY';
  if (score >= SUCCESS_WARNING_THRESHOLD) return 'WARNING';
  return 'CRITICAL';
}

export interface SuccessComponent {
  key: string;
  label: string;
  weight: number;
  score: number;
  detail: string;
}

export interface SuccessRisk {
  code: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
}

export interface SuccessRecommendation {
  code: string;
  action: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  owner: 'CSM' | 'SUPPORT' | 'PLATFORM';
}

export interface SuccessSignals {
  plan: string | null;
  tenantStatus: string | null;
  category: string;
  workflows: number;
  monthlyExecutions: number;
  totalExecutions: number;
  successRate: number;
  tokensThisMonth: number;
  tokenLimit: number | null;
  activeUsers: number;
  totalMembers: number;
  openTickets: number;
  breachedTickets: number;
  escalations: number;
}

export interface SuccessIntelligenceReport {
  workspaceId: string;
  companyName: string;
  account: EnterpriseAccountView | null;
  status: SuccessIntelligenceStatus;
  score: number;
  components: SuccessComponent[];
  signals: SuccessSignals;
  risks: SuccessRisk[];
  recommendations: SuccessRecommendation[];
  generatedAt: string;
}
const DEFAULT_PORTFOLIO_LIMIT = 25;
const MAX_PORTFOLIO_LIMIT = 50;
const ACTIVE_USER_DAYS = 30;

export interface SuccessPortfolioReport {
  accounts: SuccessIntelligenceReport[];
  summary: {
    total: number;
    healthy: number;
    warning: number;
    critical: number;
    averageScore: number;
    criticalWorkspaces: Array<{ workspaceId: string; companyName: string; score: number }>;
  };
  generatedAt: string;
}

export class CustomerSuccessIntelligenceService {
  /** One workspace scored from recorded usage, reliability, adoption, activity and support. */
  async evaluate(workspaceId: string, options: { now?: Date | undefined } = {}): Promise<SuccessIntelligenceReport> {
    const now = options.now ?? new Date();
    const workspaceIdObj = new Types.ObjectId(workspaceId);
    const [workspace, usage, success, account, pressureMap] = await Promise.all([
      WorkspaceModel.findById(workspaceIdObj).select('name').lean(),
      WorkspaceUsageModel.findOne({ workspaceId: workspaceIdObj }).lean(),
      customerSuccessService.evaluate(workspaceId, { now }),
      accountManagementService.findAccountForWorkspace(workspaceId, now),
      slaMonitoringService.pressureFor([workspaceIdObj]),
    ]);
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
    const pressure = pressureMap.get(workspaceId) ?? { open: 0, breached: 0, escalations: 0 };
    const workflows = usage ? usage.totalWorkflows : 0;
    const monthlyExecutions = usage ? usage.monthlyExecutions : 0;
    const totalExecutions = usage ? usage.totalExecutions : 0;
    const successRate = usage ? Math.max(0, Math.min(1, usage.successRate)) : 0;

    const usageScore = Math.round(Math.min(1, workflows / 5) * 50 + Math.min(1, monthlyExecutions / 100) * 50);
    const successRateScore = totalExecutions === 0 ? 70 : Math.round(successRate * 100);
    const adoption = success.adoption;
    const adoptedRatio = adoption.totalFeatureCount > 0 ? adoption.adoptedFeatureCount / adoption.totalFeatureCount : 0;
    const tokens = success.aiUsage.tokensThisMonth;
    const aiScore = Math.round(adoptedRatio * 70 + (tokens > 0 ? 30 : 0));
    const teamScore = Math.round(Math.max(0, Math.min(100, adoption.activeUserPercent)));
    const supportScore = Math.max(0, 100 - pressure.open * 10 - pressure.breached * 25 - pressure.escalations * 10);
    const components: SuccessComponent[] = [
      {
        key: 'usage',
        label: 'Usage',
        weight: 25,
        score: usageScore,
        detail: `${workflows} workflow(s), ${monthlyExecutions} execution(s) in the last 30 days`,
      },
      {
        key: 'successRate',
        label: 'Workflow success rate',
        weight: 25,
        score: successRateScore,
        detail: totalExecutions === 0
          ? 'No executions recorded yet'
          : `${Math.round(successRate * 1000) / 10}% success across ${totalExecutions} execution(s)`,
      },
      {
        key: 'aiAdoption',
        label: 'AI adoption',
        weight: 20,
        score: aiScore,
        detail: `${adoption.adoptedFeatureCount}/${adoption.totalFeatureCount} features adopted, ${tokens} token(s) this month`,
      },
      {
        key: 'teamActivity',
        label: 'Team activity',
        weight: 15,
        score: teamScore,
        detail: `${adoption.activeUsers}/${adoption.totalMembers} member(s) active in ${ACTIVE_USER_DAYS} days`,
      },
      {
        key: 'support',
        label: 'Support issues',
        weight: 15,
        score: supportScore,
        detail: `${pressure.open} open ticket(s), ${pressure.breached} breached, ${pressure.escalations} escalation(s)`,
      },
    ];

    const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
    const score = Math.round(
      components.reduce((sum, component) => sum + component.score * component.weight, 0) / totalWeight,
    );
    const risks: SuccessRisk[] = [];
    if (usageScore < 40) {
      risks.push({ code: 'LOW_USAGE', severity: 'HIGH', message: `Only ${workflows} workflow(s) and ${monthlyExecutions} execution(s) in the last 30 days` });
    }
    if (totalExecutions > 0 && successRateScore < 60) {
      risks.push({ code: 'FAILING_WORKFLOWS', severity: 'HIGH', message: `Success rate is ${Math.round(successRate * 1000) / 10}%` });
    }
    if (aiScore < 30) {
      risks.push({ code: 'LOW_AI_ADOPTION', severity: 'MEDIUM', message: `${adoption.adoptedFeatureCount}/${adoption.totalFeatureCount} AI features adopted` });
    }
    if (teamScore < 40) {
      risks.push({ code: 'LOW_TEAM_ACTIVITY', severity: 'MEDIUM', message: `${adoption.activeUsers} of ${adoption.totalMembers} member(s) active in 30 days` });
    }
    if (pressure.breached > 0) {
      risks.push({ code: 'SLA_BREACHES', severity: 'HIGH', message: `${pressure.breached} ticket(s) breached their SLA` });
    }
    if (account && (account.customerStatus === 'AT_RISK' || account.customerStatus === 'CHURNED')) {
      risks.push({ code: 'ACCOUNT_AT_RISK', severity: 'HIGH', message: `Account status is ${account.customerStatus}` });
    }

    const recommendations: SuccessRecommendation[] = [];
    if (teamScore < 40) {
      recommendations.push({ code: 'INVITE_TEAM', action: 'Invite more of the customer team and run an enablement session', priority: 'HIGH', owner: 'CSM' });
    }
    if (totalExecutions > 0 && successRateScore < 60) {
      recommendations.push({ code: 'REVIEW_FAILURES', action: 'Review failing workflows with the customer', priority: 'HIGH', owner: 'SUPPORT' });
    }
    if (pressure.open > 0) {
      recommendations.push({ code: 'RESOLVE_TICKETS', action: `Close the ${pressure.open} open support ticket(s)`, priority: pressure.breached > 0 ? 'HIGH' : 'MEDIUM', owner: 'SUPPORT' });
    }
    if (usageScore < 40) {
      recommendations.push({ code: 'DRIVE_ADOPTION', action: 'Schedule an adoption review and publish starter workflows', priority: 'MEDIUM', owner: 'CSM' });
    }
    if (aiScore < 30) {
      recommendations.push({ code: 'EXPAND_AI', action: 'Introduce AI copilot and governance basics', priority: 'LOW', owner: 'CSM' });
    }
    return {
      workspaceId,
      companyName: workspace.name,
      account,
      status: intelligenceStatusForScore(score),
      score,
      components,
      signals: {
        plan: success.plan,
        tenantStatus: success.tenantStatus,
        category: success.category,
        workflows,
        monthlyExecutions,
        totalExecutions,
        successRate: Math.round(successRate * 1000) / 10,
        tokensThisMonth: tokens,
        tokenLimit: success.aiUsage.tokenLimit,
        activeUsers: adoption.activeUsers,
        totalMembers: adoption.totalMembers,
        openTickets: pressure.open,
        breachedTickets: pressure.breached,
        escalations: pressure.escalations,
      },
      risks,
      recommendations,
      generatedAt: new Date().toISOString(),
    };
  }
  /** The book, newest workspaces first, folded into a portfolio summary. */
  async portfolio(options: {
    limit?: number | undefined;
    status?: SuccessIntelligenceStatus | undefined;
    now?: Date | undefined;
  } = {}) {
    const requested = Number.isFinite(options.limit) && options.limit && options.limit > 0
      ? Math.floor(options.limit)
      : DEFAULT_PORTFOLIO_LIMIT;
    const limit = Math.min(MAX_PORTFOLIO_LIMIT, requested);
    const workspaces = await WorkspaceModel.find({}).sort({ createdAt: -1 }).limit(limit).select('_id').lean();

    const reports: SuccessIntelligenceReport[] = [];
    for (const workspace of workspaces) {
      reports.push(await this.evaluate(
        workspace._id.toString(),
        options.now !== undefined ? { now: options.now } : {},
      ));
    }

    const accounts = options.status
      ? reports.filter((report) => report.status === options.status)
      : reports;
    const healthy = reports.filter((report) => report.status === 'HEALTHY').length;
    const warning = reports.filter((report) => report.status === 'WARNING').length;
    const critical = reports.filter((report) => report.status === 'CRITICAL');
    const averageScore = reports.length > 0
      ? Math.round(reports.reduce((sum, report) => sum + report.score, 0) / reports.length)
      : 0;

    return {
      accounts,
      summary: {
        total: reports.length,
        healthy,
        warning,
        critical: critical.length,
        averageScore,
        criticalWorkspaces: critical.map((report) => ({
          workspaceId: report.workspaceId,
          companyName: report.companyName,
          score: report.score,
        })),
      },
      generatedAt: new Date().toISOString(),
    };
  }
}

export const customerSuccessIntelligenceService = new CustomerSuccessIntelligenceService();