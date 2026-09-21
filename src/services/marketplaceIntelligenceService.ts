import { Types } from 'mongoose';
import { AgentMarketplaceModel, type IAgentMarketplace } from '../models/AgentMarketplaceModel.js';
import { AgentVersionModel } from '../models/AgentVersionModel.js';
import { InstalledAgentModel } from '../models/InstalledAgentModel.js';
import { AgentReviewModel } from '../models/AgentReviewModel.js';
import { AgentRunModel } from '../models/AgentRunModel.js';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { NotificationModel } from '../models/NotificationModel.js';
import { notificationService } from './notificationService.js';
import { AIGovernancePolicyService } from './aiGovernancePolicyService.js';
import { createAuditLog } from './auditService.js';
import { AISecurityService } from './ai/aiSecurityService.js';
import { roleHasAgentMarketplacePermission } from '../auth/permissions.js';
import type { WorkspaceRole } from '../models/WorkspaceMemberModel.js';

export const ANALYTICS_TIMEFRAMES = ['7d', '30d', '90d'] as const;
export type AnalyticsTimeframe = (typeof ANALYTICS_TIMEFRAMES)[number];

const TIMEFRAME_DAYS: Record<AnalyticsTimeframe, number> = { '7d': 7, '30d': 30, '90d': 90 };
const DAY_MS = 24 * 60 * 60 * 1000;
const HEALTH_WINDOW_DAYS = 30;
const INACTIVE_DAYS = 30;
const STALE_PUBLICATION_DAYS = 90;
const NOTIFICATION_DEDUPE_HOURS = 24;

function toObjectId(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw new Error('INVALID_REQUEST');
  return new Types.ObjectId(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function dayKeys(days: number): string[] {
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    keys.push(new Date(Date.now() - offset * DAY_MS).toISOString().slice(0, 10));
  }
  return keys;
}

function bucketByDay(days: number, dates: Date[]): Array<{ date: string; count: number }> {
  const buckets = new Map<string, number>(dayKeys(days).map((key) => [key, 0]));
  for (const date of dates) {
    const key = new Date(date).toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([date, count]) => ({ date, count }));
}
export interface MarketplaceHealthReport {
  listingId: string;
  name: string;
  score: number;
  band: 'HEALTHY' | 'WATCH' | 'AT_RISK';
  confidence: 'HIGH' | 'LOW';
  runsAnalyzed: number;
  signals: {
    versionAdoption: number;
    failureRate: number;
    toolErrorRate: number;
    policyViolations: number;
    reviewTrend: number;
    recentAverageRating: number | null;
  };
}

export class MarketplaceIntelligenceService {
  private static instance: MarketplaceIntelligenceService;
  public static getInstance(): MarketplaceIntelligenceService {
    if (!MarketplaceIntelligenceService.instance) {
      MarketplaceIntelligenceService.instance = new MarketplaceIntelligenceService();
    }
    return MarketplaceIntelligenceService.instance;
  }

  private async audit(
    action: 'MARKETPLACE_RECOMMENDATIONS_VIEWED' | 'AGENT_HEALTH_EVALUATED' | 'AGENT_LIFECYCLE_EVENT_TRIGGERED' | 'OPERATIONS_METRICS_VIEWED',
    params: { workspaceId: string; userId?: string; resourceId?: string; metadata?: Record<string, unknown> },
  ): Promise<void> {
    await createAuditLog({
      action,
      workspaceId: params.workspaceId,
      ...(params.userId ? { userId: params.userId } : {}),
      resource: 'AgentMarketplace',
      ...(params.resourceId ? { resourceId: params.resourceId } : {}),
      metadata: AISecurityService.sanitizeMetadata(params.metadata ?? {}),
    });
  }

  private visibilityFilter(wsId: Types.ObjectId): Record<string, unknown> {
    return {
      $or: [
        { visibility: 'PUBLIC' },
        { visibility: 'WORKSPACE', workspaceId: wsId },
        { visibility: 'PRIVATE', workspaceId: wsId },
      ],
    };
  }
  async getAnalytics(workspaceId: string, userId: string, timeframe: AnalyticsTimeframe = '30d') {
    const days = TIMEFRAME_DAYS[timeframe] ?? 30;
    const since = new Date(Date.now() - days * DAY_MS);
    const wsId = toObjectId(workspaceId);

    const installs = await InstalledAgentModel.find({ workspaceId: wsId }).lean();
    const activeInstalls = installs.filter((install) => install.status === 'ACTIVE');
    const localAgentIds = installs.map((install) => install.agentId);
    const runs = localAgentIds.length > 0
      ? await AgentRunModel.find({ workspaceId: wsId, agentId: { $in: localAgentIds }, createdAt: { $gte: since } })
          .select('agentId status createdAt')
          .lean()
      : [];

    const runsByAgent = new Map<string, { runs: number; failures: number }>();
    for (const run of runs) {
      const key = run.agentId.toString();
      const entry = runsByAgent.get(key) ?? { runs: 0, failures: 0 };
      entry.runs += 1;
      if (run.status === 'FAILED') entry.failures += 1;
      runsByAgent.set(key, entry);
    }

    const listings = await AgentMarketplaceModel.find({ workspaceId: wsId }).lean();
    const listingIds = listings.map((listing) => listing._id);
    const clones = listingIds.length > 0
      ? await InstalledAgentModel.find({ agentMarketplaceId: { $in: listingIds } })
          .select('agentId agentMarketplaceId status createdAt')
          .lean()
      : [];
    const cloneIds = clones.map((clone) => clone.agentId);
    const cloneRuns = cloneIds.length > 0
      ? await AgentRunModel.find({ agentId: { $in: cloneIds }, createdAt: { $gte: since } })
          .select('agentId status')
          .lean()
      : [];
    const cloneRunsByAgent = new Map<string, { runs: number; failures: number }>();
    for (const run of cloneRuns) {
      const key = run.agentId.toString();
      const entry = cloneRunsByAgent.get(key) ?? { runs: 0, failures: 0 };
      entry.runs += 1;
      if (run.status === 'FAILED') entry.failures += 1;
      cloneRunsByAgent.set(key, entry);
    }
    const lifetimeInstalls = listingIds.length > 0
      ? await InstalledAgentModel.countDocuments({ agentMarketplaceId: { $in: listingIds } })
      : 0;
    const perListing = listings.map((listing) => {
      const listingClones = clones.filter(
        (clone) => clone.agentMarketplaceId.toString() === listing._id.toString(),
      );
      const executions = listingClones.reduce(
        (sum, clone) => sum + (cloneRunsByAgent.get(clone.agentId.toString())?.runs ?? 0),
        0,
      );
      return {
        listingId: listing._id.toString(),
        name: listing.name,
        status: listing.status,
        visibility: listing.visibility,
        installs: listing.installCount,
        activeInstalls: listingClones.filter((clone) => clone.status === 'ACTIVE').length,
        executions,
        rating: listing.rating,
        versionCount: listing.versionCount,
      };
    });

    const executionsInWindow = cloneRuns.length;
    const ratedListings = listings.filter((listing) => listing.rating.count > 0);
    const averageRating = ratedListings.length > 0
      ? round2(ratedListings.reduce((sum, listing) => sum + listing.rating.average, 0) / ratedListings.length)
      : 0;
    const adoptionRate = lifetimeInstalls > 0 ? round2(executionsInWindow / lifetimeInstalls) : 0;
    const unusedAgents = activeInstalls
      .filter((install) => !runsByAgent.has(install.agentId.toString()))
      .map((install) => {
        const listing = listings.find(
          (entry) => entry._id.toString() === install.agentMarketplaceId.toString(),
        );
        return {
          listingId: install.agentMarketplaceId.toString(),
          agentId: install.agentId.toString(),
          name: listing?.name ?? 'Installed agent',
        };
      });

    const topAgentsByExecutions = activeInstalls
      .map((install) => {
        const stats = runsByAgent.get(install.agentId.toString());
        const listing = listings.find(
          (entry) => entry._id.toString() === install.agentMarketplaceId.toString(),
        );
        return {
          agentId: install.agentId.toString(),
          name: listing?.name ?? 'Installed agent',
          runs: stats?.runs ?? 0,
          failures: stats?.failures ?? 0,
        };
      })
      .sort((left, right) => right.runs - left.runs)
      .slice(0, 5);

    await this.audit('OPERATIONS_METRICS_VIEWED', {
      workspaceId,
      userId,
      metadata: { scope: 'agent-marketplace-analytics', timeframe },
    });
    return {
      timeframe,
      generatedAt: new Date().toISOString(),
      workspace: {
        activeInstallations: activeInstalls.length,
        totalInstallations: installs.length,
        executionsInWindow: runs.length,
        failuresInWindow: runs.filter((run) => run.status === 'FAILED').length,
        executionsOverTime: bucketByDay(days, runs.map((run) => run.createdAt)),
        unusedAgents,
        topAgentsByExecutions,
      },
      publisher: {
        publishedListings: listings.filter((listing) => listing.status === 'PUBLISHED').length,
        draftListings: listings.filter((listing) => listing.status === 'DRAFT').length,
        archivedListings: listings.filter((listing) => listing.status === 'ARCHIVED').length,
        lifetimeInstalls,
        installsInWindow: clones.filter((clone) => clone.createdAt >= since).length,
        installsOverTime: bucketByDay(
          days,
          clones.filter((clone) => clone.createdAt >= since).map((clone) => clone.createdAt),
        ),
        activeInstalls: clones.filter((clone) => clone.status === 'ACTIVE').length,
        executionsInWindow,
        adoptionRate,
        averageRating,
        perListing,
        topListings: [...perListing].sort((left, right) => right.installs - left.installs).slice(0, 5),
      },
    };
  }
  private async computeHealth(listing: IAgentMarketplace): Promise<MarketplaceHealthReport> {
    const since = new Date(Date.now() - HEALTH_WINDOW_DAYS * DAY_MS);
    const previousSince = new Date(Date.now() - 2 * HEALTH_WINDOW_DAYS * DAY_MS);

    const installs = await InstalledAgentModel.find({ agentMarketplaceId: listing._id }).lean();
    const activeInstalls = installs.filter((install) => install.status === 'ACTIVE');
    const onLatest = activeInstalls.filter(
      (install) => install.installedVersion >= listing.versionCount,
    ).length;
    const versionAdoption = activeInstalls.length > 0 ? onLatest / activeInstalls.length : 1;

    const cloneIds = installs.map((install) => install.agentId);
    const runs = cloneIds.length > 0
      ? await AgentRunModel.find({ agentId: { $in: cloneIds }, createdAt: { $gte: since } })
          .select('status toolCalls')
          .lean()
      : [];
    const completed = runs.filter(
      (run) => run.status === 'SUCCEEDED' || run.status === 'FAILED',
    ).length;
    const failures = runs.filter((run) => run.status === 'FAILED').length;
    const failureRate = completed > 0 ? failures / completed : 0;

    let toolCalls = 0;
    let toolErrors = 0;
    for (const run of runs) {
      for (const call of run.toolCalls ?? []) {
        toolCalls += 1;
        if (call.status === 'FAILED' || call.status === 'DENIED') toolErrors += 1;
      }
    }
    const toolErrorRate = toolCalls > 0 ? toolErrors / toolCalls : 0;

    const policyViolations = await AuditLogModel.countDocuments({
      action: 'AGENT_MARKETPLACE_POLICY_BLOCKED',
      resourceId: listing._id.toString(),
      createdAt: { $gte: since },
    });
    const [recentReviews, previousReviews] = await Promise.all([
      AgentReviewModel.aggregate<{ average: number; count: number }>([
        { $match: { agentMarketplaceId: listing._id, createdAt: { $gte: since } } },
        { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]),
      AgentReviewModel.aggregate<{ average: number; count: number }>([
        { $match: { agentMarketplaceId: listing._id, createdAt: { $gte: previousSince, $lt: since } } },
        { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]),
    ]);
    const recentAverage = recentReviews[0]?.count ? round2(recentReviews[0].average) : null;
    const previousAverage = previousReviews[0]?.count ? round2(previousReviews[0].average) : null;
    const reviewTrend = recentAverage !== null && previousAverage !== null
      ? round2(recentAverage - previousAverage)
      : 0;
    const reviewPenalty = recentAverage !== null ? Math.max(0, 4 - recentAverage) * 6 : 0;

    const rawScore = 100
      - failureRate * 35
      - toolErrorRate * 20
      - Math.min(policyViolations, 5) * 4
      - (1 - versionAdoption) * 25
      - reviewPenalty;
    const score = round1(Math.max(0, Math.min(100, rawScore)));
    const band: MarketplaceHealthReport['band'] = score >= 80 ? 'HEALTHY' : score >= 60 ? 'WATCH' : 'AT_RISK';

    return {
      listingId: listing._id.toString(),
      name: listing.name,
      score,
      band,
      confidence: completed >= 3 ? 'HIGH' : 'LOW',
      runsAnalyzed: runs.length,
      signals: {
        versionAdoption: round2(versionAdoption),
        failureRate: round2(failureRate),
        toolErrorRate: round2(toolErrorRate),
        policyViolations,
        reviewTrend,
        recentAverageRating: recentAverage,
      },
    };
  }
  async getHealth(workspaceId: string, userId: string, listingId?: string) {
    const wsId = toObjectId(workspaceId);

    if (listingId) {
      if (!Types.ObjectId.isValid(listingId)) throw new Error('INVALID_REQUEST');
      const listing = await AgentMarketplaceModel.findById(listingId);
      if (!listing) throw new Error('LISTING_NOT_FOUND');
      if (listing.visibility !== 'PUBLIC' && listing.workspaceId.toString() !== workspaceId) {
        throw new Error('LISTING_NOT_FOUND');
      }
      const report = await this.computeHealth(listing);
      await this.audit('AGENT_HEALTH_EVALUATED', {
        workspaceId,
        userId,
        resourceId: listingId,
        metadata: { band: report.band, score: report.score },
      });
      return { generatedAt: new Date().toISOString(), reports: [report] };
    }

    const listings = await AgentMarketplaceModel.find({
      status: 'PUBLISHED',
      ...this.visibilityFilter(wsId),
    }).limit(50).lean();

    const reports: MarketplaceHealthReport[] = [];
    for (const listing of listings) {
      reports.push(await this.computeHealth(listing));
    }

    await this.audit('AGENT_HEALTH_EVALUATED', {
      workspaceId,
      userId,
      metadata: {
        listings: reports.length,
        atRisk: reports.filter((report) => report.band === 'AT_RISK').length,
      },
    });
    return { generatedAt: new Date().toISOString(), reports };
  }
  async getRecommendations(workspaceId: string, userId: string, role: WorkspaceRole | undefined, limit = 5) {
    const wsId = toObjectId(workspaceId);
    const safeLimit = limit > 0 ? Math.min(limit, 20) : 5;
    const engine = AIGovernancePolicyService.getInstance();

    const featureCheck = await engine.evaluateRequest({
      workspaceId,
      userId,
      ...(role ? { role } : {}),
      feature: 'AI_AGENT',
      dryRun: true,
    });

    const installable = role ? roleHasAgentMarketplacePermission(role, 'AGENT_INSTALL') : true;
    const installed = await InstalledAgentModel.find({ workspaceId: wsId, status: 'ACTIVE' }).lean();
    const installedListingIds = installed.map((install) => install.agentMarketplaceId);
    const installedListings = installedListingIds.length > 0
      ? await AgentMarketplaceModel.find({ _id: { $in: installedListingIds } }).lean()
      : [];

    const categoryAffinity = new Map<string, number>();
    const tagAffinity = new Set<string>();
    const installedPublishers = new Set<string>();
    for (const listing of installedListings) {
      categoryAffinity.set(listing.category, (categoryAffinity.get(listing.category) ?? 0) + 1);
      for (const tag of listing.tags) tagAffinity.add(tag);
      installedPublishers.add(listing.publisherId.toString());
    }
    if (featureCheck.decision === 'DENY') {
      await this.audit('MARKETPLACE_RECOMMENDATIONS_VIEWED', {
        workspaceId,
        userId,
        metadata: {
          candidates: 0,
          excluded: 0,
          featureBlocked: true,
          reasonCodes: featureCheck.reasonCodes,
        },
      });
      return {
        generatedAt: new Date().toISOString(),
        featurePolicy: { decision: featureCheck.decision, reasonCodes: featureCheck.reasonCodes },
        installable,
        items: [] as Array<Record<string, unknown>>,
        blockedByGovernance: [] as Array<Record<string, unknown>>,
      };
    }

    const candidates = await AgentMarketplaceModel.find({
      status: 'PUBLISHED',
      _id: { $nin: installedListingIds },
      ...this.visibilityFilter(wsId),
    })
      .sort({ 'rating.average': -1, installCount: -1 })
      .limit(40)
      .lean();

    const modelDecisions = new Map<string, { allowed: boolean; reasonCodes: string[] }>();
    const blockedByGovernance: Array<Record<string, unknown>> = [];
    const scored: Array<Record<string, unknown>> = [];
    for (const candidate of candidates) {
      const model = candidate.agentSnapshot?.modelConfig?.model ?? null;
      if (model) {
        let decision = modelDecisions.get(model);
        if (!decision) {
          const result = await engine.evaluateRequest({
            workspaceId,
            userId,
            ...(role ? { role } : {}),
            feature: 'AI_AGENT',
            model,
            dryRun: true,
          });
          decision = { allowed: result.decision !== 'DENY', reasonCodes: result.reasonCodes };
          modelDecisions.set(model, decision);
        }
        if (!decision.allowed) {
          blockedByGovernance.push({
            listingId: candidate._id.toString(),
            name: candidate.name,
            model,
            reasonCodes: decision.reasonCodes,
          });
          continue;
        }
      }

      const reasons: string[] = [];
      let score = 0;
      const affinity = categoryAffinity.get(candidate.category) ?? 0;
      if (affinity > 0) {
        score += Math.min(30, 15 * affinity);
        reasons.push(`Matches your ${candidate.category} usage`);
      }
      const sharedTags = candidate.tags.filter((tag) => tagAffinity.has(tag));
      if (sharedTags.length > 0) {
        score += 15;
        reasons.push(`Shares tags with installed agents: ${sharedTags.slice(0, 3).join(', ')}`);
      }
      if (candidate.rating.count > 0) {
        score += (candidate.rating.average / 5) * 20;
        reasons.push(`Rated ${candidate.rating.average.toFixed(1)} by ${candidate.rating.count} workspace(s)`);
      }
      if (candidate.installCount > 0) {
        score += Math.min(15, Math.log10(candidate.installCount + 1) * 10);
        reasons.push(`${candidate.installCount} install(s)`);
      }
      if (!installedPublishers.has(candidate.publisherId.toString())) {
        score += 5;
        reasons.push('Publisher you have not installed from yet');
      }
      const daysSinceUpdate = Math.floor((Date.now() - new Date(candidate.updatedAt).getTime()) / DAY_MS);
      if (daysSinceUpdate <= 30) {
        score += 10;
        reasons.push('Updated in the last 30 days');
      } else if (daysSinceUpdate <= 90) {
        score += 5;
      }

      scored.push({
        listingId: candidate._id.toString(),
        name: candidate.name,
        description: candidate.description,
        category: candidate.category,
        tags: candidate.tags,
        visibility: candidate.visibility,
        rating: candidate.rating,
        installCount: candidate.installCount,
        versionCount: candidate.versionCount,
        model,
        score: round1(score),
        reasons,
      });
    }
    const items = scored
      .sort((left, right) => (right.score as number) - (left.score as number))
      .slice(0, safeLimit)
      .map((item) => ({ ...item, installable }));

    await this.audit('MARKETPLACE_RECOMMENDATIONS_VIEWED', {
      workspaceId,
      userId,
      metadata: {
        candidates: candidates.length,
        excluded: blockedByGovernance.length,
        returned: items.length,
      },
    });

    return {
      generatedAt: new Date().toISOString(),
      featurePolicy: { decision: featureCheck.decision, reasonCodes: featureCheck.reasonCodes },
      installable,
      items,
      blockedByGovernance,
    };
  }
  private async notifyPublisher(params: {
    userId: string;
    workspaceId: string;
    listingId: string;
    listingName: string;
    eventType: string;
    title: string;
    message: string;
  }): Promise<boolean> {
    try {
      if (!Types.ObjectId.isValid(params.userId) || !Types.ObjectId.isValid(params.workspaceId)) return false;
      const since = new Date(Date.now() - NOTIFICATION_DEDUPE_HOURS * 60 * 60 * 1000);
      const existing = await NotificationModel.findOne({
        userId: toObjectId(params.userId),
        resourceId: params.listingId,
        'metadata.eventType': params.eventType,
        createdAt: { $gte: since },
      }).lean();
      if (existing) return false;

      await notificationService.createNotification({
        userId: params.userId,
        workspaceId: params.workspaceId,
        type: 'SYSTEM',
        title: params.title,
        message: params.message,
        resourceType: 'AgentMarketplaceListing',
        resourceId: params.listingId,
        metadata: { eventType: params.eventType, listingName: params.listingName },
      });
      return true;
    } catch {
      return false;
    }
  }
  async getLifecycle(workspaceId: string, userId: string) {
    const wsId = toObjectId(workspaceId);
    const inactiveSince = new Date(Date.now() - INACTIVE_DAYS * DAY_MS);
    const staleSince = new Date(Date.now() - STALE_PUBLICATION_DAYS * DAY_MS);

    const installs = await InstalledAgentModel.find({
      workspaceId: wsId,
      status: { $in: ['ACTIVE', 'DISABLED'] },
    }).lean();
    const listingIds = installs.map((install) => install.agentMarketplaceId);
    const listings = listingIds.length > 0
      ? await AgentMarketplaceModel.find({ _id: { $in: listingIds } }).lean()
      : [];
    const listingMap = new Map(listings.map((listing) => [listing._id.toString(), listing]));

    const cloneIds = installs.map((install) => install.agentId);
    const recentlyRunIds = cloneIds.length > 0
      ? await AgentRunModel.distinct('agentId', {
          agentId: { $in: cloneIds },
          createdAt: { $gte: inactiveSince },
        })
      : [];
    const recentlyRun = new Set((recentlyRunIds as unknown[]).map((id) => String(id)));

    const installerEvents: Array<Record<string, unknown>> = [];
    const deprecatedByListing = new Map<string, { listing: IAgentMarketplace; count: number }>();
    for (const install of installs) {
      const listing = listingMap.get(install.agentMarketplaceId.toString());
      if (!listing) continue;
      const base = {
        listingId: listing._id.toString(),
        listingName: listing.name,
        localAgentId: install.agentId.toString(),
        installedVersion: install.installedVersion,
        latestVersion: listing.versionCount,
      };

      if (listing.status === 'ARCHIVED') {
        installerEvents.push({
          ...base,
          type: 'LISTING_ARCHIVED',
          severity: 'WARNING',
          message: `${listing.name} was archived by its publisher`,
        });
      } else if (install.installedVersion < listing.versionCount) {
        const gap = listing.versionCount - install.installedVersion;
        installerEvents.push({
          ...base,
          type: gap >= 2 ? 'DEPRECATED_VERSION' : 'UPDATE_AVAILABLE',
          severity: gap >= 2 ? 'WARNING' : 'INFO',
          message: gap >= 2
            ? `${listing.name} is ${gap} versions behind the published release`
            : `${listing.name} has an update available`,
        });
        const entry = deprecatedByListing.get(listing._id.toString()) ?? { listing, count: 0 };
        entry.count += 1;
        deprecatedByListing.set(listing._id.toString(), entry);
      }

      if (!recentlyRun.has(install.agentId.toString())) {
        installerEvents.push({
          ...base,
          type: 'INACTIVE_AGENT',
          severity: 'INFO',
          message: `${listing.name} has not run in the last ${INACTIVE_DAYS} days`,
        });
      }
    }
    const publisherListings = await AgentMarketplaceModel.find({
      workspaceId: wsId,
      status: 'PUBLISHED',
    }).lean();
    const publisherEvents: Array<Record<string, unknown>> = [];

    for (const listing of publisherListings) {
      const base = { listingId: listing._id.toString(), listingName: listing.name };
      const recentInstalls = await InstalledAgentModel.countDocuments({
        agentMarketplaceId: listing._id,
        createdAt: { $gte: inactiveSince },
      });
      const clones = await InstalledAgentModel.find({ agentMarketplaceId: listing._id })
        .select('agentId')
        .lean();
      const recentExecutions = clones.length > 0
        ? await AgentRunModel.countDocuments({
            agentId: { $in: clones.map((clone) => clone.agentId) },
            createdAt: { $gte: inactiveSince },
          })
        : 0;

      if (recentInstalls === 0 && recentExecutions === 0) {
        publisherEvents.push({
          ...base,
          type: 'INACTIVE_LISTING',
          severity: 'INFO',
          message: `No installs or executions in the last ${INACTIVE_DAYS} days`,
        });
      }

      const latestVersion = await AgentVersionModel.findOne({ agentMarketplaceId: listing._id })
        .sort({ versionNumber: -1 })
        .select('createdAt')
        .lean();
      if (latestVersion && latestVersion.createdAt < staleSince) {
        publisherEvents.push({
          ...base,
          type: 'STALE_PUBLICATION',
          severity: 'INFO',
          message: `No new version published in the last ${STALE_PUBLICATION_DAYS} days`,
        });
      }
    }
    let notificationsCreated = 0;
    for (const event of publisherEvents) {
      const listing = publisherListings.find((entry) => entry._id.toString() === event.listingId);
      if (!listing) continue;
      const created = await this.notifyPublisher({
        userId: listing.publisherId.toString(),
        workspaceId,
        listingId: event.listingId as string,
        listingName: listing.name,
        eventType: event.type as string,
        title: 'Marketplace lifecycle alert',
        message: `${listing.name}: ${event.message as string}`,
      });
      if (created) notificationsCreated += 1;
    }
    for (const [listingId, entry] of deprecatedByListing) {
      if (entry.count === 0) continue;
      const created = await this.notifyPublisher({
        userId: entry.listing.publisherId.toString(),
        workspaceId,
        listingId,
        listingName: entry.listing.name,
        eventType: 'DEPRECATED_ADOPTION',
        title: 'Installers are running older versions',
        message: `${entry.count} workspace(s) are running versions behind the published release of ${entry.listing.name}.`,
      });
      if (created) notificationsCreated += 1;
    }

    const summary = {
      totalEvents: installerEvents.length + publisherEvents.length,
      updates: installerEvents.filter((event) => event.type === 'UPDATE_AVAILABLE').length,
      deprecated: installerEvents.filter((event) => event.type === 'DEPRECATED_VERSION').length,
      inactiveAgents: installerEvents.filter((event) => event.type === 'INACTIVE_AGENT').length,
      archivedListings: installerEvents.filter((event) => event.type === 'LISTING_ARCHIVED').length,
      inactiveListings: publisherEvents.filter((event) => event.type === 'INACTIVE_LISTING').length,
      stalePublications: publisherEvents.filter((event) => event.type === 'STALE_PUBLICATION').length,
      notificationsCreated,
    };
    await this.audit('AGENT_LIFECYCLE_EVENT_TRIGGERED', {
      workspaceId,
      userId,
      metadata: {
        totalEvents: summary.totalEvents,
        notificationsCreated,
        updates: summary.updates,
        deprecated: summary.deprecated,
      },
    });

    return {
      generatedAt: new Date().toISOString(),
      installer: { events: installerEvents },
      publisher: { events: publisherEvents, notificationsCreated },
      summary,
    };
  }
}

export const marketplaceIntelligenceService = MarketplaceIntelligenceService.getInstance();
export default marketplaceIntelligenceService;