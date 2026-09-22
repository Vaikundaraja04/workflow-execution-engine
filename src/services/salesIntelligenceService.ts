import { Types } from 'mongoose';
import { LeadModel } from '../models/LeadModel.js';
import { ConversionEventModel } from '../models/ConversionEventModel.js';
import { GrowthEventModel } from '../models/GrowthEventModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { WorkspaceMemberModel } from '../models/WorkspaceMemberModel.js';
import { leadService } from './leadService.js';
import type { LeadListFilters, LeadRow } from './leadService.js';

/**
 * Phase 16.2 - Sales CRM intelligence.
 *
 * Ranks the pipeline with real engagement rather than form fields alone: the
 * firmographic score from leadService is blended with product telemetry
 * (workflow usage, team invitations, demo executions, pricing visits) into a
 * 0-100 score with a band, company priority, buying intent and the next action
 * the owner should take. Read-only - it never mutates a lead.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ENGAGEMENT_WINDOW_DAYS = 30;
const MAX_LEADS = 200;

export type IntelligenceBand = 'HOT' | 'WARM' | 'NURTURE' | 'COLD';
export type CompanyTier = 'ENTERPRISE' | 'MID_MARKET' | 'SMB';
export type IntentBand = 'HIGH' | 'MEDIUM' | 'LOW';

export interface LeadEngagement {
  score: number;
  pricingVisits: number;
  demoExecutions: number;
  workflowsCreated: number;
  teamInvitations: number;
  lastActivityAt: string | null;
}

export interface IntelligenceFactor {
  factor: 'fit' | 'intent' | 'engagement' | 'recency';
  label: string;
  weight: number;
  score: number;
  detail: string;
}

export interface SalesRecommendation {
  code: string;
  action: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  owner: 'SDR' | 'AE' | 'CSM';
}

export interface LeadIntelligence {
  leadId: string;
  company: string;
  contactName: string;
  contactEmail: string;
  industry: string;
  companySize: string | null;
  interest: string | null;
  source: string;
  status: string;
  demoStatus: string;
  workspaceId: string | null;
  demoWorkspaceId: string | null;
  assignedTo: string | null;
  estimatedValueMonthly: number | null;
  score: number;
  band: IntelligenceBand;
  baseScore: number;
  factors: IntelligenceFactor[];
  engagement: LeadEngagement;
  companyPriority: { tier: CompanyTier; score: number; reason: string };
  buyingIntent: { band: IntentBand; score: number; signals: string[] };
  recommendations: SalesRecommendation[];
  followUpStatus: string;
  lastContactedAt: string | null;
  capturedAt: string;
  generatedAt: string;
}

export interface SalesIntelligenceSummary {
  total: number;
  bands: { hot: number; warm: number; nurture: number; cold: number };
  averageScore: number;
  pipelineValueMonthly: number;
  followUps: { overdue: number; due: number };
  topOpportunity: { leadId: string; company: string; score: number } | null;
}

export interface SalesIntelligenceReport {
  leads: LeadIntelligence[];
  summary: SalesIntelligenceSummary;
  generatedAt: string;
}

function recencyScore(lastActivityAt: Date | null, capturedAt: Date, now: Date): number {
  const reference = lastActivityAt ?? capturedAt;
  const idleDays = Math.floor((now.getTime() - reference.getTime()) / MS_PER_DAY);
  if (idleDays <= 3) return 100;
  if (idleDays <= 7) return 80;
  if (idleDays <= 14) return 60;
  if (idleDays <= 30) return 35;
  return 10;
}

function bandForScore(score: number): IntelligenceBand {
  if (score >= 75) return 'HOT';
  if (score >= 50) return 'WARM';
  if (score >= 30) return 'NURTURE';
  return 'COLD';
}

interface Telemetry {
  pricingVisits: Map<string, number>;
  growthActivity: Map<string, Date>;
  workflows: Map<string, number>;
  members: Map<string, number>;
  executions: Map<string, number>;
}

export class SalesIntelligenceService {
  /** Batched telemetry for a set of leads: no per-lead queries. */
  private async loadTelemetry(
    leads: Array<{ leadId: string; workspaceId: string | null }>,
    now: Date,
  ): Promise<Telemetry> {
    const leadIds = leads
      .map((lead) => lead.leadId)
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    const workspaceIds = [...new Set(
      leads
        .map((lead) => lead.workspaceId)
        .filter((id): id is string => Boolean(id) && Types.ObjectId.isValid(id as string)),
    )].map((id) => new Types.ObjectId(id));
    const since = new Date(now.getTime() - ENGAGEMENT_WINDOW_DAYS * MS_PER_DAY);
    const [pricingRows, activityRows, workflowRows, memberRows, executionRows] = await Promise.all([
      ConversionEventModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { leadId: { $in: leadIds }, source: 'PRICING_PAGE' } },
        { $group: { _id: '$leadId', count: { $sum: 1 } } },
      ]),
      GrowthEventModel.aggregate<{ _id: Types.ObjectId; last: Date }>([
        { $match: { leadId: { $in: leadIds } } },
        { $group: { _id: '$leadId', last: { $max: '$occurredAt' } } },
      ]),
      this.workflowRowsFor(workspaceIds),
      WorkspaceMemberModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { workspaceId: { $in: workspaceIds } } },
        { $group: { _id: '$workspaceId', count: { $sum: 1 } } },
      ]),
      WorkflowExecutionModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { workspaceId: { $in: workspaceIds }, createdAt: { $gte: since } } },
        { $group: { _id: '$workspaceId', count: { $sum: 1 } } },
      ]),
    ]);

    return {
      pricingVisits: new Map(pricingRows.map((row) => [row._id.toString(), row.count])),
      growthActivity: new Map(activityRows.map((row) => [row._id.toString(), new Date(row.last)])),
      workflows: new Map(workflowRows.map((row) => [row._id.toString(), row.count])),
      members: new Map(memberRows.map((row) => [row._id.toString(), row.count])),
      executions: new Map(executionRows.map((row) => [row._id.toString(), row.count])),
    };
  }

  private async workflowRowsFor(workspaceIds: Types.ObjectId[]): Promise<Array<{ _id: Types.ObjectId; count: number }>> {
    if (workspaceIds.length === 0) return [];
    return WorkflowModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { workspaceId: { $in: workspaceIds } } },
      { $group: { _id: '$workspaceId', count: { $sum: 1 } } },
    ]);
  }

  /** Score one lead with its engagement telemetry. */
  async scoreLead(leadId: string): Promise<LeadIntelligence> {
    const lead = await leadService.get(leadId);
    const now = new Date();
    const telemetry = await this.loadTelemetry(
      [{ leadId: lead.id, workspaceId: lead.workspaceId ?? lead.demoWorkspaceId ?? null }],
      now,
    );
    return buildIntelligence(lead, telemetry, now);
  }

  /** Rank the pipeline and summarise it for the sales board. */
  async intelligence(filters: LeadListFilters = {}): Promise<SalesIntelligenceReport> {
    const now = new Date();
    const listed = await leadService.list({ ...filters, limit: Math.min(filters.limit ?? 50, MAX_LEADS) });
    const telemetry = await this.loadTelemetry(
      listed.leads.map((lead) => ({
        leadId: lead.id,
        workspaceId: lead.workspaceId ?? lead.demoWorkspaceId ?? null,
      })),
      now,
    );
    const leads = listed.leads.map((lead) => buildIntelligence(lead, telemetry, now));
    leads.sort((a, b) => b.score - a.score);
    return { leads, summary: buildSummary(leads), generatedAt: new Date().toISOString() };
  }
}
function engagementSignals(input: {
  pricingVisits: number;
  workflowsCreated: number;
  teamInvitations: number;
  demoExecutions: number;
  idleDays: number | null;
}): string[] {
  const signals: string[] = [];
  if (input.pricingVisits > 0) signals.push(`viewed pricing ${input.pricingVisits}x`);
  if (input.workflowsCreated > 0) signals.push(`built ${input.workflowsCreated} workflows`);
  if (input.teamInvitations > 0) signals.push(`invited ${input.teamInvitations} teammates`);
  if (input.demoExecutions > 0) signals.push(`ran ${input.demoExecutions} executions in the last 30 days`);
  if (input.idleDays !== null && input.idleDays > 14) signals.push(`no product activity for ${input.idleDays} days`);
  if (signals.length === 0) signals.push('no product activity recorded yet');
  return signals;
}

function companyPriorityFor(lead: LeadRow): LeadIntelligence['companyPriority'] {
  const sizeScores: Record<string, number> = {
    '1-10': 40,
    '11-50': 60,
    '51-200': 80,
    '201-1000': 95,
    '1000+': 100,
  };
  const sizeScore = lead.companySize ? sizeScores[lead.companySize] ?? 50 : 50;
  const interestBoost = lead.interest === 'ENTERPRISE' ? 10 : lead.interest === 'BUSINESS' ? 5 : 0;
  const score = Math.min(100, sizeScore + interestBoost);
  const tier: CompanyTier = score >= 90 ? 'ENTERPRISE' : score >= 60 ? 'MID_MARKET' : 'SMB';
  return {
    tier,
    score,
    reason: `${lead.companySize ?? 'unknown'} employees in ${lead.industry}${lead.interest ? `, interested in ${lead.interest}` : ''}`,
  };
}

function buildIntelligence(lead: LeadRow, telemetry: Telemetry, now: Date): LeadIntelligence {
  const workspaceKey = lead.workspaceId ?? lead.demoWorkspaceId ?? null;
  const pricingVisits = telemetry.pricingVisits.get(lead.id) ?? 0;
  const workflowsCreated = workspaceKey ? telemetry.workflows.get(workspaceKey) ?? 0 : 0;
  const members = workspaceKey ? telemetry.members.get(workspaceKey) ?? 0 : 0;
  const demoExecutions = workspaceKey ? telemetry.executions.get(workspaceKey) ?? 0 : 0;
  const teamInvitations = Math.max(0, members - 1);
  const lastActivityAt = telemetry.growthActivity.get(lead.id) ?? null;
  const capturedAt = new Date(lead.capturedAt);
  const reference = lastActivityAt ?? capturedAt;
  const idleDays = Math.floor((now.getTime() - reference.getTime()) / MS_PER_DAY);

  const engagementScore = Math.min(100,
    Math.min(25, pricingVisits * 8)
    + Math.min(25, workflowsCreated * 5)
    + Math.min(20, teamInvitations * 10)
    + Math.min(30, demoExecutions * 3));

  const recency = recencyScore(lastActivityAt, capturedAt, now);
  const factors: IntelligenceFactor[] = [
    {
      factor: 'fit',
      label: 'Company fit',
      weight: 0.25,
      score: lead.score.factors.fit,
      detail: `${lead.companySize ?? 'unknown size'} in ${lead.industry}`,
    },
    {
      factor: 'intent',
      label: 'Buying signals',
      weight: 0.2,
      score: lead.score.factors.intent,
      detail: `interest ${lead.interest ?? 'unknown'}, demo ${lead.demoStatus}`,
    },
    {
      factor: 'engagement',
      label: 'Product engagement',
      weight: 0.35,
      score: engagementScore,
      detail: `${pricingVisits} pricing visits, ${workflowsCreated} workflows, ${teamInvitations} invitations, ${demoExecutions} executions (30d)`,
    },
    {
      factor: 'recency',
      label: 'Recency',
      weight: 0.2,
      score: recency,
      detail: lastActivityAt ? `active ${idleDays} day(s) ago` : `no product activity since capture ${idleDays} day(s) ago`,
    },
  ];
  const score = Math.round(factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0));
  const intentScore = Math.round(lead.score.factors.intent * 0.35 + engagementScore * 0.45 + recency * 0.2);
  const intentBand: IntentBand = intentScore >= 70 ? 'HIGH' : intentScore >= 40 ? 'MEDIUM' : 'LOW';

  return {
    leadId: lead.id,
    company: lead.company,
    contactName: lead.contactName,
    contactEmail: lead.contactEmail,
    industry: lead.industry,
    companySize: lead.companySize,
    interest: lead.interest,
    source: lead.source,
    status: lead.status,
    demoStatus: lead.demoStatus,
    workspaceId: lead.workspaceId ?? null,
    demoWorkspaceId: lead.demoWorkspaceId ?? null,
    assignedTo: lead.assignedTo ?? null,
    estimatedValueMonthly: lead.estimatedValueMonthly ?? null,
    score,
    band: bandForScore(score),
    baseScore: lead.score.score,
    factors,
    engagement: {
      score: engagementScore,
      pricingVisits,
      demoExecutions,
      workflowsCreated,
      teamInvitations,
      lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
    },
    companyPriority: companyPriorityFor(lead),
    buyingIntent: {
      band: intentBand,
      score: intentScore,
      signals: engagementSignals({ pricingVisits, workflowsCreated, teamInvitations, demoExecutions, idleDays }),
    },
    recommendations: recommendationsFor(lead, {
      score,
      engagementScore,
      intentBand,
      pricingVisits,
      idleDays,
      workflowsCreated,
      demoExecutions,
    }),
    followUpStatus: lead.followUpStatus,
    lastContactedAt: lead.lastContactedAt ? new Date(lead.lastContactedAt).toISOString() : null,
    capturedAt: capturedAt.toISOString(),
    generatedAt: now.toISOString(),
  };
}

function recommendationsFor(
  lead: LeadRow,
  context: {
    score: number;
    engagementScore: number;
    intentBand: IntentBand;
    pricingVisits: number;
    idleDays: number;
    workflowsCreated: number;
    demoExecutions: number;
  },
): SalesRecommendation[] {
  const recommendations: SalesRecommendation[] = [];

  if (lead.status === 'WON' || lead.status === 'LOST') {
    recommendations.push({
      code: 'CLOSED_RECORD',
      action: lead.status === 'WON'
        ? 'Hand the account to customer success for onboarding and expansion'
        : 'Record the loss reason and move the lead into the nurture sequence',
      priority: 'LOW',
      owner: lead.status === 'WON' ? 'CSM' : 'SDR',
    });
    return recommendations;
  }

  if (lead.followUpStatus === 'overdue') {
    recommendations.push({
      code: 'FOLLOW_UP_OVERDUE',
      action: 'Follow-up is overdue - contact the lead today and log the outcome',
      priority: 'HIGH',
      owner: 'SDR',
    });
  }
  if (lead.demoStatus === 'REQUESTED' || lead.status === 'DEMO_SCHEDULED') {
    recommendations.push({
      code: 'RUN_DEMO',
      action: 'Demo requested - start the scenario sandbox and walk the team through it',
      priority: 'HIGH',
      owner: 'AE',
    });
  }
  if (lead.demoStatus === 'COMPLETED' && context.intentBand !== 'LOW') {
    recommendations.push({
      code: 'SEND_PROPOSAL',
      action: 'Demo completed with strong intent - generate the proposal with pricing and the ROI estimate',
      priority: 'HIGH',
      owner: 'AE',
    });
  }
  if (context.pricingVisits >= 2) {
    recommendations.push({
      code: 'PRICING_FOLLOW_UP',
      action: `Visited pricing ${context.pricingVisits} times - answer the pricing question directly and share the package comparison`,
      priority: 'MEDIUM',
      owner: 'AE',
    });
  }
  if (context.engagementScore >= 60 && lead.demoStatus === 'NONE') {
    recommendations.push({
      code: 'TECHNICAL_DEEP_DIVE',
      action: 'High product engagement without a demo - offer a technical deep dive on their workflow',
      priority: 'MEDIUM',
      owner: 'SDR',
    });
  }
  if (context.idleDays > 14) {
    recommendations.push({
      code: 'REENGAGE',
      action: `No product activity for ${context.idleDays} days - send the value recap and offer a shorter follow-up`,
      priority: context.idleDays > 30 ? 'MEDIUM' : 'LOW',
      owner: 'SDR',
    });
  }
  if (context.workflowsCreated >= 3 && lead.demoStatus !== 'NONE') {
    recommendations.push({
      code: 'EXPANSION_SCOPE',
      action: 'Several workflows already built - scope a multi-team rollout before the trial ends',
      priority: 'MEDIUM',
      owner: 'AE',
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      code: 'QUALIFY',
      action: 'Qualify the lead: confirm the use case, the team size and the decision timeline',
      priority: context.score >= 50 ? 'MEDIUM' : 'LOW',
      owner: 'SDR',
    });
  }

  return recommendations;
}

function buildSummary(leads: LeadIntelligence[]): SalesIntelligenceSummary {
  const bands = {
    hot: leads.filter((lead) => lead.band === 'HOT').length,
    warm: leads.filter((lead) => lead.band === 'WARM').length,
    nurture: leads.filter((lead) => lead.band === 'NURTURE').length,
    cold: leads.filter((lead) => lead.band === 'COLD').length,
  };
  const top = leads.length > 0
    ? leads.reduce((best, lead) => (lead.score > best.score ? lead : best), leads[0] as LeadIntelligence)
    : null;

  return {
    total: leads.length,
    bands,
    averageScore: leads.length > 0
      ? Math.round(leads.reduce((sum, lead) => sum + lead.score, 0) / leads.length)
      : 0,
    pipelineValueMonthly: leads.reduce((sum, lead) => sum + (lead.estimatedValueMonthly ?? 0), 0),
    followUps: {
      overdue: leads.filter((lead) => lead.followUpStatus === 'overdue').length,
      due: leads.filter((lead) => lead.followUpStatus === 'due').length,
    },
    topOpportunity: top ? { leadId: top.leadId, company: top.company, score: top.score } : null,
  };
}

export const salesIntelligenceService = new SalesIntelligenceService();
