import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { AgentModel, type IAgent } from '../models/AgentModel.js';
import {
  AgentMarketplaceModel,
  type IAgentMarketplace,
  type IAgentDefinitionSnapshot,
  type AgentMarketplaceVisibility,
  type AgentPricingModel,
} from '../models/AgentMarketplaceModel.js';
import { AgentVersionModel } from '../models/AgentVersionModel.js';
import { InstalledAgentModel, type IInstalledAgentConfiguration } from '../models/InstalledAgentModel.js';
import { AgentReviewModel } from '../models/AgentReviewModel.js';
import { PublisherProfileModel } from '../models/PublisherProfileModel.js';
import { UserModel } from '../models/UserModel.js';
import { AgentService, type CreateAgentInput } from './agent/agentService.js';
import { AgentToolRegistry } from './agent/agentToolRegistry.js';
import { AgentToolPolicyService } from './agent/agentToolPolicyService.js';
import { AIGovernancePolicyService } from './aiGovernancePolicyService.js';
import { AISecurityService } from './ai/aiSecurityService.js';
import { createAuditLog } from './auditService.js';
import type { AuditAction } from '../models/AuditLogModel.js';
import type { WorkspaceRole } from '../models/WorkspaceMemberModel.js';
import { agentMarketplaceBillingService } from './agentMarketplaceBillingService.js';

export interface CreateListingInput {
  agentId: string;
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  visibility?: AgentMarketplaceVisibility;
  icon?: string;
  documentation?: string;
  pricing?: { model?: AgentPricingModel; priceUSD?: number; currency?: string };
}

export type UpdateListingInput = Partial<Omit<CreateListingInput, 'agentId'>>;

export interface AgentMarketplaceSearchFilters {
  q?: string;
  category?: string;
  tag?: string;
  publisherId?: string;
  minRating?: number;
  sortBy?: 'rating' | 'installs' | 'executions' | 'recent';
  page?: number;
  limit?: number;
}

export interface InstallConfiguration extends IInstalledAgentConfiguration {}

interface GovernanceCheckpointResult {
  blocked: boolean;
  reasonCodes: string[];
  blockedTools: string[];
}
function toObjectId(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw new Error('INVALID_REQUEST');
  return new Types.ObjectId(value);
}

function snapshotFromAgent(agent: IAgent): IAgentDefinitionSnapshot {
  const modelConfig: IAgentDefinitionSnapshot['modelConfig'] = {};
  if (agent.modelConfig?.provider !== undefined) modelConfig.provider = agent.modelConfig.provider;
  if (agent.modelConfig?.model !== undefined) modelConfig.model = agent.modelConfig.model;
  if (agent.modelConfig?.temperature !== undefined) modelConfig.temperature = agent.modelConfig.temperature;
  if (agent.modelConfig?.maxTokens !== undefined) modelConfig.maxTokens = agent.modelConfig.maxTokens;
  if (agent.modelConfig?.maxTurns !== undefined) modelConfig.maxTurns = agent.modelConfig.maxTurns;
  const snapshot: IAgentDefinitionSnapshot = {
    name: agent.name,
    systemPrompt: agent.systemPrompt,
    modelConfig,
    orchestrationMode: agent.orchestrationMode,
    toolsAllowed: [...(agent.toolsAllowed ?? [])],
    requiredPermissions: [...(agent.requiredPermissions ?? [])],
    memoryEnabled: agent.memoryEnabled,
  };
  if (agent.description !== undefined) snapshot.description = agent.description;
  return snapshot;
}

function hashSnapshot(snapshot: IAgentDefinitionSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export class AgentMarketplaceService {
  private static instance: AgentMarketplaceService;
  public static getInstance(): AgentMarketplaceService {
    if (!AgentMarketplaceService.instance) AgentMarketplaceService.instance = new AgentMarketplaceService();
    return AgentMarketplaceService.instance;
  }

  private async audit(
    action: AuditAction,
    params: { workspaceId?: string; userId?: string; resourceId?: string; metadata?: Record<string, unknown> },
  ): Promise<void> {
    await createAuditLog({
      action,
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.userId ? { userId: params.userId } : {}),
      resource: 'AgentMarketplace',
      ...(params.resourceId ? { resourceId: params.resourceId } : {}),
      metadata: AISecurityService.sanitizeMetadata(params.metadata ?? {}),
    });
  }
  private async runGovernanceCheckpoint(params: {
    workspaceId: string;
    userId?: string;
    role?: WorkspaceRole;
    snapshot: IAgentDefinitionSnapshot;
    enforceToolPolicies: boolean;
  }): Promise<GovernanceCheckpointResult> {
    const engine = AIGovernancePolicyService.getInstance();
    const decision = await engine.evaluateRequest({
      workspaceId: params.workspaceId,
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.role ? { role: params.role } : {}),
      feature: 'AI_AGENT',
      ...(params.snapshot.modelConfig.model ? { model: params.snapshot.modelConfig.model } : {}),
      ...(params.snapshot.modelConfig.provider ? { provider: params.snapshot.modelConfig.provider } : {}),
      prompt: params.snapshot.systemPrompt.slice(0, 1000),
      dryRun: true,
    });
    const blockedTools: string[] = [];
    if (params.enforceToolPolicies) {
      const policyService = AgentToolPolicyService.getInstance();
      for (const tool of params.snapshot.toolsAllowed) {
        if (blockedTools.includes(tool)) continue;
        const policy = await policyService.resolvePolicy(params.workspaceId, tool);
        if (policy === 'DENY') blockedTools.push(tool);
      }
    }
    return {
      blocked: decision.decision === 'DENY' || blockedTools.length > 0,
      reasonCodes: [...decision.reasonCodes, ...blockedTools.map((tool) => `TOOL_DENIED:${tool}`)],
      blockedTools,
    };
  }
  private async blockForPolicy(params: {
    workspaceId: string;
    userId?: string;
    listingId?: string;
    phase: 'PUBLISH' | 'INSTALL';
    result: GovernanceCheckpointResult;
  }): Promise<never> {
    await this.audit('AGENT_MARKETPLACE_POLICY_BLOCKED', {
      workspaceId: params.workspaceId,
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.listingId ? { resourceId: params.listingId } : {}),
      metadata: {
        phase: params.phase,
        reasonCodes: params.result.reasonCodes,
        blockedTools: params.result.blockedTools,
      },
    });
    throw new Error('AGENT_MARKETPLACE_POLICY_BLOCKED');
  }
  private async resolveToolConfiguration(workspaceId: string, tools: string[]): Promise<Record<string, string>> {
    const policyService = AgentToolPolicyService.getInstance();
    const configuration: Record<string, string> = {};
    for (const tool of tools) {
      configuration[tool] = await policyService.resolvePolicy(workspaceId, tool);
    }
    return configuration;
  }

  private async ensurePublisherProfile(userId: string) {
    const userIdObj = toObjectId(userId);
    const existing = await PublisherProfileModel.findOne({ userId: userIdObj });
    if (existing) return existing;
    const user = await UserModel.findById(userIdObj).lean();
    const displayName = user?.email ? user.email.split('@')[0] ?? 'Publisher' : 'Publisher';
    return PublisherProfileModel.create({
      userId: userIdObj,
      displayName,
      publisherType: 'INDIVIDUAL',
      verified: false,
    });
  }
  private async refreshPublisherStats(publisherId: string): Promise<void> {
    const publisherIdObj = toObjectId(publisherId);
    const listings = await AgentMarketplaceModel.find({ publisherId: publisherIdObj })
      .select('status rating.average rating.count installCount')
      .lean();
    const published = listings.filter((listing) => listing.status === 'PUBLISHED');
    const totalInstalls = listings.reduce((sum, listing) => sum + (listing.installCount ?? 0), 0);
    const rated = published.filter((listing) => (listing.rating?.count ?? 0) > 0);
    const averageRating = rated.length > 0
      ? round2(rated.reduce((sum, listing) => sum + (listing.rating?.average ?? 0), 0) / rated.length)
      : 0;
    await PublisherProfileModel.updateOne(
      { userId: publisherIdObj },
      {
        $set: {
          'stats.publishedAgents': published.length,
          'stats.totalInstalls': totalInstalls,
          'stats.averageRating': averageRating,
        },
      },
    );
  }
  async createListing(workspaceId: string, userId: string, input: CreateListingInput): Promise<IAgentMarketplace> {
    if (!input.agentId) throw new Error('INVALID_REQUEST');
    const wsId = toObjectId(workspaceId);
    const agent = await AgentModel.findOne({ _id: toObjectId(input.agentId), workspaceId: wsId });
    if (!agent) throw new Error('AGENT_NOT_FOUND');
    const existing = await AgentMarketplaceModel.findOne({ workspaceId: wsId, agentId: agent._id });
    if (existing) throw new Error('LISTING_ALREADY_EXISTS');

    const doc: Record<string, unknown> = {
      workspaceId: wsId,
      agentId: agent._id,
      publisherId: toObjectId(userId),
      name: (input.name ?? agent.name).trim(),
      description: input.description ?? agent.description ?? '',
      category: input.category ?? 'Automation',
      tags: input.tags ?? [],
      visibility: input.visibility ?? 'WORKSPACE',
      status: 'DRAFT',
      pricing: {
        model: input.pricing?.model ?? 'FREE',
        priceUSD: input.pricing?.priceUSD ?? 0,
        currency: input.pricing?.currency ?? 'USD',
      },
      createdBy: toObjectId(userId),
    };
    if (input.icon !== undefined) doc.icon = input.icon;
    if (input.documentation !== undefined) doc.documentation = input.documentation;
    const listing = await AgentMarketplaceModel.create(doc);
    await this.audit('AGENT_LISTING_CREATED', {
      workspaceId,
      userId,
      resourceId: listing._id.toString(),
      metadata: { agentId: input.agentId, visibility: listing.visibility, category: listing.category },
    });
    return listing;
  }
  async updateListing(listingId: string, workspaceId: string, patch: UpdateListingInput): Promise<IAgentMarketplace> {
    const listing = await AgentMarketplaceModel.findOne({ _id: toObjectId(listingId), workspaceId: toObjectId(workspaceId) });
    if (!listing) throw new Error('LISTING_NOT_FOUND');
    if (patch.name !== undefined) listing.name = patch.name.trim();
    if (patch.description !== undefined) listing.description = patch.description;
    if (patch.category !== undefined) listing.category = patch.category;
    if (patch.tags !== undefined) listing.tags = patch.tags;
    if (patch.visibility !== undefined) listing.visibility = patch.visibility;
    if (patch.icon !== undefined) listing.icon = patch.icon;
    if (patch.documentation !== undefined) listing.documentation = patch.documentation;
    if (patch.pricing !== undefined) {
      if (patch.pricing.model !== undefined) listing.pricing.model = patch.pricing.model;
      if (patch.pricing.priceUSD !== undefined) listing.pricing.priceUSD = patch.pricing.priceUSD;
      if (patch.pricing.currency !== undefined) listing.pricing.currency = patch.pricing.currency;
    }
    await listing.save();
    return listing;
  }

  async archiveAgent(listingId: string, workspaceId: string, userId: string): Promise<IAgentMarketplace> {
    const listing = await AgentMarketplaceModel.findOne({ _id: toObjectId(listingId), workspaceId: toObjectId(workspaceId) });
    if (!listing) throw new Error('LISTING_NOT_FOUND');
    listing.status = 'ARCHIVED';
    await listing.save();
    await this.refreshPublisherStats(listing.publisherId.toString());
    await this.audit('AGENT_LISTING_ARCHIVED', {
      workspaceId,
      userId,
      resourceId: listing._id.toString(),
      metadata: { publisherId: listing.publisherId.toString() },
    });
    return listing;
  }
  private async ensureVersion(
    listing: IAgentMarketplace,
    snapshot: IAgentDefinitionSnapshot,
    toolConfiguration: Record<string, string>,
    reasonCodes: string[],
    userId: string,
    changeSummary: string,
  ) {
    const hash = hashSnapshot(snapshot);
    const latest = await AgentVersionModel.findOne({ agentMarketplaceId: listing._id }).sort({ versionNumber: -1 });
    if (latest && latest.hash === hash) return latest;
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    const version = await AgentVersionModel.create({
      agentMarketplaceId: listing._id,
      versionNumber,
      agentDefinitionSnapshot: snapshot,
      toolConfiguration,
      governanceSnapshot: {
        checkedAt: new Date(),
        reasonCodes,
        ...(snapshot.modelConfig.model ? { modelChecked: snapshot.modelConfig.model } : {}),
        toolPolicies: toolConfiguration,
      },
      changeSummary,
      hash,
      createdBy: toObjectId(userId),
    });
    listing.latestVersion = version._id;
    listing.versionCount = versionNumber;
    await this.audit('AGENT_VERSION_CREATED', {
      workspaceId: listing.workspaceId.toString(),
      userId,
      resourceId: listing._id.toString(),
      metadata: { versionNumber, hash, changeSummary },
    });
    return version;
  }
  async publishAgent(listingId: string, workspaceId: string, userId: string, role?: WorkspaceRole): Promise<IAgentMarketplace> {
    const listing = await AgentMarketplaceModel.findOne({ _id: toObjectId(listingId), workspaceId: toObjectId(workspaceId) });
    if (!listing) throw new Error('LISTING_NOT_FOUND');
    if (listing.status === 'ARCHIVED') throw new Error('INVALID_REQUEST');
    const agent = await AgentModel.findOne({ _id: listing.agentId, workspaceId: toObjectId(workspaceId) });
    if (!agent) throw new Error('AGENT_NOT_FOUND');

    const snapshot = snapshotFromAgent(agent);
    const checkpoint = await this.runGovernanceCheckpoint({
      workspaceId,
      userId,
      ...(role ? { role } : {}),
      snapshot,
      enforceToolPolicies: true,
    });
    if (checkpoint.blocked) {
      await this.blockForPolicy({ workspaceId, userId, listingId: listing._id.toString(), phase: 'PUBLISH', result: checkpoint });
    }

    await this.ensurePublisherProfile(userId);
    const toolConfiguration = await this.resolveToolConfiguration(workspaceId, snapshot.toolsAllowed);
    const version = await this.ensureVersion(
      listing,
      snapshot,
      toolConfiguration,
      checkpoint.reasonCodes,
      userId,
      listing.versionCount === 0 ? 'Initial publication' : 'Publication update',
    );

    listing.agentSnapshot = snapshot;
    listing.status = 'PUBLISHED';
    await listing.save();
    await this.refreshPublisherStats(listing.publisherId.toString());
    await this.audit('AGENT_LISTING_PUBLISHED', {
      workspaceId,
      userId,
      resourceId: listing._id.toString(),
      metadata: { version: version.versionNumber, visibility: listing.visibility, reasonCodes: checkpoint.reasonCodes },
    });
    return listing;
  }
  async searchAgents(workspaceId: string, filters: AgentMarketplaceSearchFilters = {}) {
    const wsId = toObjectId(workspaceId);
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 50) : 20;
    const query: Record<string, unknown> = {
      status: 'PUBLISHED',
      $or: [
        { visibility: 'PUBLIC' },
        { visibility: 'WORKSPACE', workspaceId: wsId },
        { visibility: 'PRIVATE', workspaceId: wsId },
      ],
    };
    if (filters.q) query.$text = { $search: filters.q };
    if (filters.category) query.category = filters.category;
    if (filters.tag) query.tags = filters.tag;
    if (filters.publisherId && Types.ObjectId.isValid(filters.publisherId)) {
      query.publisherId = toObjectId(filters.publisherId);
    }
    if (filters.minRating !== undefined) query['rating.average'] = { $gte: filters.minRating };

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      rating: { 'rating.average': -1, installCount: -1 },
      installs: { installCount: -1, 'rating.average': -1 },
      executions: { executionCount: -1, installCount: -1 },
      recent: { updatedAt: -1 },
    };
    const sort = sortMap[filters.sortBy ?? 'rating'] ?? sortMap.rating;

    const [items, totalCount] = await Promise.all([
      AgentMarketplaceModel.find(query).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
      AgentMarketplaceModel.countDocuments(query),
    ]);
    const listingIds = items.map((item) => item._id);
    const installs = listingIds.length > 0
      ? await InstalledAgentModel.find({
          workspaceId: wsId,
          agentMarketplaceId: { $in: listingIds },
          status: { $in: ['ACTIVE', 'DISABLED'] },
        }).lean()
      : [];
    const installByListing = new Map(installs.map((entry) => [entry.agentMarketplaceId.toString(), entry]));
    return {
      items: items.map((item) => ({
        ...item,
        install: installByListing.get(item._id.toString()) ?? null,
      })),
      pagination: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) },
    };
  }
  private async findVisibleListing(listingId: string, workspaceId: string): Promise<IAgentMarketplace> {
    const listing = await AgentMarketplaceModel.findById(toObjectId(listingId));
    if (!listing) throw new Error('LISTING_NOT_FOUND');
    const sameWorkspace = listing.workspaceId.toString() === workspaceId;
    if (listing.visibility !== 'PUBLIC' && !sameWorkspace) throw new Error('LISTING_NOT_FOUND');
    return listing;
  }

  async getAgentDetails(listingId: string, workspaceId: string) {
    const listing = await this.findVisibleListing(listingId, workspaceId);
    const [latestVersion, publisher, install, reviews] = await Promise.all([
      listing.latestVersion
        ? AgentVersionModel.findById(listing.latestVersion).lean()
        : Promise.resolve(null),
      PublisherProfileModel.findOne({ userId: listing.publisherId }).lean(),
      InstalledAgentModel.findOne({
        workspaceId: toObjectId(workspaceId),
        agentMarketplaceId: listing._id,
      }).lean(),
      AgentReviewModel.find({ agentMarketplaceId: listing._id }).sort({ createdAt: -1 }).limit(5).lean(),
    ]);
    return {
      listing: JSON.parse(JSON.stringify(listing)),
      latestVersion,
      publisher,
      install,
      reviews,
    };
  }
  async listVersions(listingId: string, workspaceId: string) {
    await this.findVisibleListing(listingId, workspaceId);
    return AgentVersionModel.find({ agentMarketplaceId: toObjectId(listingId) })
      .sort({ versionNumber: -1 })
      .lean();
  }

  async compareVersions(listingId: string, workspaceId: string, fromVersion: number, toVersion: number) {
    await this.findVisibleListing(listingId, workspaceId);
    const listingIdObj = toObjectId(listingId);
    const [from, to] = await Promise.all([
      AgentVersionModel.findOne({ agentMarketplaceId: listingIdObj, versionNumber: fromVersion }).lean(),
      AgentVersionModel.findOne({ agentMarketplaceId: listingIdObj, versionNumber: toVersion }).lean(),
    ]);
    if (!from || !to) throw new Error('VERSION_NOT_FOUND');

    const snapshotFields = [
      'name',
      'description',
      'systemPrompt',
      'modelConfig',
      'orchestrationMode',
      'requiredPermissions',
      'memoryEnabled',
    ] as const;
    const fromSnapshot = from.agentDefinitionSnapshot as unknown as Record<string, unknown>;
    const toSnapshot = to.agentDefinitionSnapshot as unknown as Record<string, unknown>;
    const changedFields = snapshotFields.filter(
      (field) => JSON.stringify(fromSnapshot[field]) !== JSON.stringify(toSnapshot[field]),
    );
    const fromTools = (from.agentDefinitionSnapshot.toolsAllowed ?? []) as string[];
    const toTools = (to.agentDefinitionSnapshot.toolsAllowed ?? []) as string[];

    return {
      from: { versionNumber: from.versionNumber, hash: from.hash, createdAt: from.createdAt },
      to: { versionNumber: to.versionNumber, hash: to.hash, createdAt: to.createdAt },
      identical: from.hash === to.hash,
      changedFields,
      toolsAdded: toTools.filter((tool) => !fromTools.includes(tool)),
      toolsRemoved: fromTools.filter((tool) => !toTools.includes(tool)),
      governanceChanged: JSON.stringify(from.governanceSnapshot) !== JSON.stringify(to.governanceSnapshot),
    };
  }
  async rollbackToVersion(listingId: string, workspaceId: string, userId: string, targetVersion: number) {
    const listing = await AgentMarketplaceModel.findOne({
      _id: toObjectId(listingId),
      workspaceId: toObjectId(workspaceId),
    });
    if (!listing) throw new Error('LISTING_NOT_FOUND');
    const target = await AgentVersionModel.findOne({
      agentMarketplaceId: listing._id,
      versionNumber: targetVersion,
    });
    if (!target) throw new Error('VERSION_NOT_FOUND');

    const snapshot = target.agentDefinitionSnapshot as IAgentDefinitionSnapshot;
    const toolConfiguration = (target.toolConfiguration ?? {}) as Record<string, string>;
    const version = await this.ensureVersion(
      listing,
      snapshot,
      toolConfiguration,
      [`ROLLBACK_TO:${targetVersion}`],
      userId,
      `Rollback to v${targetVersion}`,
    );
    listing.agentSnapshot = snapshot;
    await listing.save();
    return version;
  }
  async installAgent(
    listingId: string,
    workspaceId: string,
    userId: string,
    config: InstallConfiguration = {},
    role?: WorkspaceRole,
  ) {
    const wsId = toObjectId(workspaceId);
    const listing = await AgentMarketplaceModel.findById(toObjectId(listingId));
    if (!listing || listing.status !== 'PUBLISHED') throw new Error('LISTING_NOT_FOUND');
    const sameWorkspace = listing.workspaceId.toString() === workspaceId;
    if (listing.visibility !== 'PUBLIC' && !sameWorkspace) throw new Error('LISTING_NOT_FOUND');

    const existing = await InstalledAgentModel.findOne({
      workspaceId: wsId,
      agentMarketplaceId: listing._id,
      status: { $in: ['ACTIVE', 'DISABLED'] },
    });
    if (existing) throw new Error('AGENT_ALREADY_INSTALLED');

    await agentMarketplaceBillingService.assertLicenseForInstall(listing._id.toString(), workspaceId);
    const snapshot = (listing.agentSnapshot ?? null) as IAgentDefinitionSnapshot | null;
    if (!snapshot) throw new Error('INVALID_REQUEST');

    const registry = AgentToolRegistry.getInstance();
    for (const tool of snapshot.toolsAllowed) {
      if (!registry.hasTool(tool)) throw new Error('UNKNOWN_TOOL');
    }

    const checkpoint = await this.runGovernanceCheckpoint({
      workspaceId,
      userId,
      ...(role ? { role } : {}),
      snapshot,
      enforceToolPolicies: true,
    });
    if (checkpoint.blocked) {
      await this.blockForPolicy({ workspaceId, userId, listingId: listing._id.toString(), phase: 'INSTALL', result: checkpoint });
    }
    return this.cloneAgentForWorkspace(listing, snapshot, workspaceId, userId, config);
  }
  private async cloneAgentForWorkspace(
    listing: IAgentMarketplace,
    snapshot: IAgentDefinitionSnapshot,
    workspaceId: string,
    userId: string,
    config: InstallConfiguration,
  ) {
    const wsId = toObjectId(workspaceId);
    const agentService = AgentService.getInstance();
    const modelConfig: IAgentDefinitionSnapshot['modelConfig'] = { ...(snapshot.modelConfig ?? {}) };
    if (config.model !== undefined) modelConfig.model = config.model;
    if (config.temperature !== undefined) modelConfig.temperature = config.temperature;
    if (config.maxTurns !== undefined) modelConfig.maxTurns = config.maxTurns;

    const agentInput: CreateAgentInput = {
      name: snapshot.name,
      systemPrompt: snapshot.systemPrompt,
      modelConfig,
      orchestrationMode: snapshot.orchestrationMode as NonNullable<CreateAgentInput['orchestrationMode']>,
      toolsAllowed: config.toolsAllowed ?? snapshot.toolsAllowed,
      requiredPermissions: snapshot.requiredPermissions,
      memoryEnabled: config.memoryEnabled ?? snapshot.memoryEnabled,
      status: 'ACTIVE',
      ...(snapshot.description ? { description: snapshot.description } : {}),
    };
    let cloned: IAgent;
    try {
      cloned = await agentService.createAgent(workspaceId, userId, agentInput);
    } catch (error) {
      if (error instanceof Error && /duplicate key/i.test(error.message)) {
        cloned = await agentService.createAgent(workspaceId, userId, {
          ...agentInput,
          name: `${snapshot.name} (${listing._id.toString().slice(-6)})`,
        });
      } else {
        throw error;
      }
    }

    const installedVersion = listing.versionCount > 0 ? listing.versionCount : 1;
    const install = await InstalledAgentModel.create({
      workspaceId: wsId,
      agentMarketplaceId: listing._id,
      agentId: cloned._id,
      installedVersion,
      configuration: config,
      installedBy: toObjectId(userId),
      status: 'ACTIVE',
      installedAt: new Date(),
    });

    listing.installCount += 1;
    listing.statistics.installs += 1;
    await listing.save();
    await this.refreshPublisherStats(listing.publisherId.toString());
    await this.audit('AGENT_LISTING_INSTALLED', {
      workspaceId,
      userId,
      resourceId: listing._id.toString(),
      metadata: {
        installedVersion,
        localAgentId: cloned._id.toString(),
        publisherId: listing.publisherId.toString(),
      },
    });
    return { install, agent: cloned };
  }
  async uninstallAgent(listingId: string, workspaceId: string, userId: string) {
    const wsId = toObjectId(workspaceId);
    const listing = await AgentMarketplaceModel.findById(toObjectId(listingId));
    if (!listing) throw new Error('LISTING_NOT_FOUND');
    const install = await InstalledAgentModel.findOne({
      workspaceId: wsId,
      agentMarketplaceId: listing._id,
      status: { $in: ['ACTIVE', 'DISABLED'] },
    });
    if (!install) throw new Error('AGENT_NOT_INSTALLED');

    install.status = 'UNINSTALLED';
    await install.save();
    await AgentModel.updateOne(
      { _id: install.agentId, workspaceId: wsId },
      { $set: { status: 'ARCHIVED' } },
    );
    listing.installCount = Math.max(0, listing.installCount - 1);
    listing.statistics.installs = Math.max(0, listing.statistics.installs - 1);
    await listing.save();
    await this.refreshPublisherStats(listing.publisherId.toString());
    await this.audit('AGENT_LISTING_UNINSTALLED', {
      workspaceId,
      userId,
      resourceId: listing._id.toString(),
      metadata: { localAgentId: install.agentId.toString() },
    });
    return { uninstalled: true, localAgentId: install.agentId.toString() };
  }
  async rateAgent(listingId: string, workspaceId: string, userId: string, rating: number, review?: string) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('INVALID_RATING');
    const wsId = toObjectId(workspaceId);
    const listing = await this.findVisibleListing(listingId, workspaceId);
    const install = await InstalledAgentModel.findOne({
      workspaceId: wsId,
      agentMarketplaceId: listing._id,
      status: 'ACTIVE',
    });
    if (!install) throw new Error('REVIEW_REQUIRES_INSTALLATION');

    const userIdObj = toObjectId(userId);
    const existing = await AgentReviewModel.findOne({ agentMarketplaceId: listing._id, userId: userIdObj });
    let doc;
    if (existing) {
      existing.rating = rating;
      if (review !== undefined) existing.review = review;
      existing.workspaceId = wsId;
      doc = await existing.save();
    } else {
      const reviewDoc: Record<string, unknown> = {
        agentMarketplaceId: listing._id,
        userId: userIdObj,
        workspaceId: wsId,
        rating,
      };
      if (review !== undefined) reviewDoc.review = review;
      doc = await AgentReviewModel.create(reviewDoc);
    }

    const aggregate = await AgentReviewModel.aggregate<{ average: number; count: number }>([
      { $match: { agentMarketplaceId: listing._id } },
      { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    const count = aggregate[0]?.count ?? 0;
    listing.rating.average = count > 0 ? round2(aggregate[0]?.average ?? 0) : 0;
    listing.rating.count = count;
    await listing.save();
    await this.refreshPublisherStats(listing.publisherId.toString());
    await this.audit('AGENT_REVIEW_CREATED', {
      workspaceId,
      userId,
      resourceId: listing._id.toString(),
      metadata: { rating, updated: Boolean(existing) },
    });
    return { review: doc, rating: { average: listing.rating.average, count: listing.rating.count } };
  }
  async listReviews(listingId: string, workspaceId: string, page = 1, limit = 20) {
    await this.findVisibleListing(listingId, workspaceId);
    const safePage = page > 0 ? page : 1;
    const safeLimit = limit > 0 ? Math.min(limit, 50) : 20;
    const query = { agentMarketplaceId: toObjectId(listingId) };
    const [items, totalCount] = await Promise.all([
      AgentReviewModel.find(query)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      AgentReviewModel.countDocuments(query),
    ]);
    return {
      items,
      pagination: { page: safePage, limit: safeLimit, totalCount, totalPages: Math.ceil(totalCount / safeLimit) },
    };
  }

  async getStats(listingId: string, workspaceId: string) {
    const listing = await this.findVisibleListing(listingId, workspaceId);
    const [activeInstalls, reviewCount, versionCount] = await Promise.all([
      InstalledAgentModel.countDocuments({ agentMarketplaceId: listing._id, status: 'ACTIVE' }),
      AgentReviewModel.countDocuments({ agentMarketplaceId: listing._id }),
      AgentVersionModel.countDocuments({ agentMarketplaceId: listing._id }),
    ]);
    return {
      listingId: listing._id.toString(),
      status: listing.status,
      visibility: listing.visibility,
      installs: { total: listing.installCount, active: activeInstalls },
      executions: listing.executionCount,
      statistics: listing.statistics,
      rating: listing.rating,
      reviewCount,
      versionCount,
    };
  }
}

export const agentMarketplaceService = AgentMarketplaceService.getInstance();
export default agentMarketplaceService;