import { Types } from 'mongoose';
import { marketplaceIntelligenceService } from './marketplaceIntelligenceService.js';
import { WorkflowTemplateMarketplaceModel } from '../models/WorkflowTemplateMarketplaceModel.js';
import { WorkflowTemplateModel } from '../models/WorkflowTemplateModel.js';
import { MarketplaceLicenseModel } from '../models/MarketplaceLicenseModel.js';
import { MarketplaceReviewModel } from '../models/MarketplaceReviewModel.js';
import { OnboardingSessionModel } from '../models/OnboardingSessionModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { AIGovernanceGate } from './aiGovernanceGate.js';
import { AISecurityService } from './ai/aiSecurityService.js';
import { createAuditLog } from './auditService.js';
import type { WorkspaceRole } from '../models/WorkspaceMemberModel.js';

/**
 * Phase 17.5 - Marketplace discovery.
 *
 * Composes the Phase 12.8 agent ranking with recorded workspace signals -
 * onboarding industry, recent execution history and the licenses already held -
 * and ranks the premium workflow marketplace the same way. AI copy is
 * optional and governed: DENY or a pending approval drops the copy only, the
 * deterministic ranking is always returned.
 */

export interface MarketplaceRecommendationCopy {
  status: 'COMPLETED' | 'PENDING_APPROVAL' | 'BLOCKED' | 'UNAVAILABLE';
  copy: string | null;
  approvalId: string | null;
  reason: string | null;
  model: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WORKFLOW_CANDIDATES = 40;
const MAX_EXECUTED_WORKFLOWS = 5;
export class MarketplaceRecommendationService {
  /**
   * Ranked agent and workflow recommendations from recorded signals, with an
   * optional governed AI summary. `includeAiCopy` defaults to true; when the
   * governance gate denies the feature the copy is dropped and the ranking
   * still returns.
   */
  async getRecommendations(input: {
    workspaceId: string;
    userId: string;
    role?: WorkspaceRole | undefined;
    limit?: number | undefined;
    includeAiCopy?: boolean | undefined;
  }) {
    const workspaceId = new Types.ObjectId(input.workspaceId);
    const limit = Number.isFinite(input.limit) && input.limit && input.limit > 0 ? Math.min(20, Math.floor(input.limit)) : 5;

    const base = await marketplaceIntelligenceService.getRecommendations(
      input.workspaceId,
      input.userId,
      input.role,
      limit,
    );

    const [onboarding, licenses, executionRows] = await Promise.all([
      OnboardingSessionModel.findOne({ workspaceId }).select('selectedIndustry').lean(),
      MarketplaceLicenseModel.find({ workspaceId, assetType: 'WORKFLOW', status: 'ACTIVE' }).select('assetId').lean(),
      WorkflowExecutionModel.aggregate<{ _id: Types.ObjectId; executions: number }>([
        { $match: { workspaceId, createdAt: { $gte: new Date(Date.now() - 30 * DAY_MS) } } },
        { $group: { _id: '$workflowId', executions: { $sum: 1 } } },
        { $sort: { executions: -1 } },
        { $limit: MAX_EXECUTED_WORKFLOWS },
      ]),
    ]);

    const industry = onboarding?.selectedIndustry ?? null;
    const licensedTemplateIds = licenses.map((row) => row.assetId);
    const executedWorkflowIds = executionRows.map((row) => row._id);
    const executedWorkflows = executedWorkflowIds.length > 0
      ? await WorkflowModel.find({ _id: { $in: executedWorkflowIds } }).select('name').lean()
      : [];
    const executionCount = new Map(executionRows.map((row) => [row._id.toString(), row.executions]));
    const historyTokens = new Set(
      executedWorkflows
        .flatMap((row) => row.name.toLowerCase().split(/[^a-z0-9]+/))
        .filter((token) => token.length >= 4),
    );
    const candidates = await WorkflowTemplateMarketplaceModel.find({
      status: 'PUBLISHED',
      workspaceId: { $ne: workspaceId },
      ...(licensedTemplateIds.length > 0 ? { templateId: { $nin: licensedTemplateIds } } : {}),
    })
      .sort({ 'statistics.sales': -1, 'statistics.installs': -1 })
      .limit(MAX_WORKFLOW_CANDIDATES)
      .lean();

    const templateIds = candidates.map((row) => row.templateId);
    const [templates, ratings] = await Promise.all([
      templateIds.length > 0
        ? WorkflowTemplateModel.find({ _id: { $in: templateIds } }).select('name description category tags').lean()
        : [],
      templateIds.length > 0
        ? MarketplaceReviewModel.aggregate<{ _id: Types.ObjectId; average: number; count: number }>([
          { $match: { assetType: 'WORKFLOW', assetId: { $in: templateIds }, status: 'PUBLISHED' } },
          { $group: { _id: '$assetId', average: { $avg: '$rating' }, count: { $sum: 1 } } },
        ])
        : [],
    ]);
    const templateMap = new Map(templates.map((row) => [row._id.toString(), row]));
    const ratingMap = new Map(ratings.map((row) => [row._id.toString(), row]));
    const industryToken = industry ? industry.toLowerCase().replace(/[^a-z0-9]+/g, '-') : null;
    const scored = candidates.map((listing) => {
      const template = templateMap.get(listing.templateId.toString());
      const rating = ratingMap.get(listing.templateId.toString());
      const reasons: string[] = [];
      let score = 0;

      if (industry && listing.industryTags.some((tag) => tag.toLowerCase().replace(/[^a-z0-9]+/g, '-') === industryToken)) {
        score += 30;
        reasons.push(`Matches your industry (${industry})`);
      }
      const nameTokens = `${template?.name ?? ''} ${template?.description ?? ''}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 4);
      const overlap = [...new Set(nameTokens.filter((token) => historyTokens.has(token)))].slice(0, 3);
      if (overlap.length > 0) {
        score += 20;
        reasons.push(`Similar to workflows you run: ${overlap.join(', ')}`);
      }
      const sales = listing.statistics?.sales ?? 0;
      if (sales > 0) {
        score += Math.min(15, Math.log10(sales + 1) * 10);
        reasons.push(`${sales} sale(s)`);
      }
      if (rating && rating.count > 0) {
        score += (rating.average / 5) * 20;
        reasons.push(`Rated ${(Math.round(rating.average * 10) / 10).toFixed(1)} by ${rating.count} workspace(s)`);
      }
      if (listing.pricingModel === 'FREE' || listing.price <= 0) {
        score += 5;
        reasons.push('Free to install');
      }
      if (reasons.length === 0) reasons.push('Popular on the marketplace');
      return {
        listingId: listing._id.toString(),
        templateId: listing.templateId.toString(),
        name: template?.name ?? 'Premium workflow',
        description: template?.description ?? '',
        category: template?.category ?? null,
        industryTags: listing.industryTags,
        pricingModel: listing.pricingModel,
        price: listing.price,
        currency: listing.currency,
        billingCycle: listing.billingCycle,
        statistics: listing.statistics,
        rating: rating ? { average: Math.round(rating.average * 10) / 10, count: rating.count } : { average: 0, count: 0 },
        score: Math.round(score * 10) / 10,
        reasons,
      };
    });
    const workflows = scored.sort((left, right) => right.score - left.score).slice(0, limit);

    const usage = executedWorkflows.map((row) => ({
      workflowId: row._id.toString(),
      name: row.name,
      executions: executionCount.get(row._id.toString()) ?? 0,
    }));

    const aiCopy = input.includeAiCopy === false
      ? { status: 'UNAVAILABLE' as const, copy: null, approvalId: null, reason: 'Disabled by request', model: null }
      : await this.generateCopy({
        workspaceId: input.workspaceId,
        userId: input.userId,
        ...(input.role !== undefined ? { role: input.role } : {}),
        industry,
        agents: base.items.slice(0, 3),
        workflows: workflows.slice(0, 3),
      });
    return {
      generatedAt: new Date().toISOString(),
      industry,
      featurePolicy: base.featurePolicy,
      installable: base.installable,
      agents: base.items,
      workflows,
      usage,
      aiCopy,
    };
  }

  /** Governed AI summary: DENY and pending approvals drop the copy only. */
  private async generateCopy(input: {
    workspaceId: string;
    userId: string;
    role?: WorkspaceRole | undefined;
    industry: string | null;
    agents: Array<Record<string, unknown>>;
    workflows: Array<Record<string, unknown>>;
  }): Promise<MarketplaceRecommendationCopy> {
    const prompt = AISecurityService.sanitizePrompt(AISecurityService.validatePrompt(this.buildBrief(input)));
    try {
      const run = await AIGovernanceGate.getInstance().runGoverned(
        {
          workspaceId: input.workspaceId,
          userId: input.userId,
          ...(input.role !== undefined ? { role: input.role } : {}),
          feature: 'AI_AGENT',
          prompt,
        },
        async (context) => {
          const text = await context.provider.generateText(context.prompt ?? prompt, { model: context.model });
          return { text: text.trim(), model: context.model, providerName: context.providerName };
        },
      );
      if (run.status === 'PENDING_APPROVAL') {
        return {
          status: 'PENDING_APPROVAL',
          copy: null,
          approvalId: run.approvalId ?? null,
          reason: 'Awaiting governance approval',
          model: null,
        };
      }
      await createAuditLog({
        action: 'MARKETPLACE_AI_COPY_GENERATED',
        userId: input.userId,
        workspaceId: new Types.ObjectId(input.workspaceId),
        resource: 'marketplace_recommendations',
        resourceId: input.workspaceId,
        metadata: {
          model: run.result.model,
          provider: run.result.providerName,
          items: input.agents.length + input.workflows.length,
        },
      });
      return { status: 'COMPLETED', copy: run.result.text, approvalId: null, reason: null, model: run.result.model };
    } catch (error) {
      const denied = error instanceof Error && error.message === 'AI_GOVERNANCE_DENIED';
      return {
        status: denied ? 'BLOCKED' : 'UNAVAILABLE',
        copy: null,
        approvalId: null,
        reason: denied ? 'Blocked by AI governance policy' : 'AI summary unavailable',
        model: null,
      };
    }
  }
  private buildBrief(input: {
    industry: string | null;
    agents: Array<Record<string, unknown>>;
    workflows: Array<Record<string, unknown>>;
  }): string {
    const lines: string[] = ['You are writing a short marketplace discovery summary for one workspace.'];
    if (input.industry) lines.push(`Industry: ${input.industry}`);
    if (input.agents.length > 0) {
      lines.push('Top agent recommendations:');
      for (const agent of input.agents) {
        lines.push(`- ${String(agent.name ?? 'Agent')} (${String(agent.category ?? 'uncategorized')})`);
      }
    }
    if (input.workflows.length > 0) {
      lines.push('Top workflow recommendations:');
      for (const workflow of input.workflows) {
        lines.push(`- ${String(workflow.name ?? 'Workflow')} (${String(workflow.pricingModel ?? 'FREE')})`);
      }
    }
    lines.push('Write at most two sentences (60 words) explaining why these fit. Do not invent metrics.');
    return lines.join('\n');
  }
}

export const marketplaceRecommendationService = new MarketplaceRecommendationService();
