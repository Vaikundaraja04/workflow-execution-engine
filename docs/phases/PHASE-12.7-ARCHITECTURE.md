# Phase 12.7 - Enterprise AI Agent Marketplace (Architecture Plan)

Status: Implemented and verified - marketplace models, service, governance-gated publish/install, versions/rollback, reviews, permissions, audit actions, routes and the marketplace console are live (backend 824/824, frontend 133/133, next build green).
Branch: phase-2e-production-hardening
Depends on: 12.2 Agent Platform (AgentModel, AgentService, AgentExecutionService, tool policies, approvals), 12.6 AI Governance (policy engine + gate), Phase 6C Workflow Marketplace (WorkflowTemplateModel, TemplateVersionModel, MarketplaceListingModel, PublisherProfileModel), RBAC (src/auth/permissions.ts), audit framework (AuditLogModel + createAuditLog).

## 1. Goal

Turn AI agents into a governed enterprise marketplace: members create agents, test them, publish listings, discover and install agents from other workspaces, configure installed agents, execute them, review them and manage versions - with the Phase 12.6 governance engine as the admission gate at publish and install time.

Lifecycle (the contract every layer supports):

    Create Agent -> Test Agent -> Publish Agent -> Discover -> Install -> Configure -> Execute -> Review -> Version

Design principles (same as 12.6): additive and opt-in, reuse before rebuild, workspace-scoped documents, everything audited, hard governance gates at publish and install (runtime execution keeps 12.6 gate semantics unchanged).
## 2. Analysis of existing assets (reused, not rebuilt)

| Asset | Location | Role in 12.7 |
| --- | --- | --- |
| AgentModel + AgentService | src/models/AgentModel.ts, src/services/agent/agentService.ts | source agent definitions; install clones an agent into the installing workspace via AgentService.createAgent |
| AgentExecutionService / AgentRunnerService | src/services/agent/* | test + execution semantics; marketplace executions reuse the same path (no parallel runtime) |
| AgentToolRegistry + tool policies | src/services/agent/agentToolRegistry.ts, agentToolPolicyService.ts | tool existence checks plus per-workspace ALLOW/DENY/REQUIRE_APPROVAL; install validates every tool in the snapshot |
| AI Governance (12.6) | src/services/aiGovernancePolicyService.ts, aiGovernanceGate.ts, src/models/AIGovernancePolicyModel.ts | publish-time and install-time admission checks (feature entitlement, model access, prompt/privacy); policy-blocked auditing |
| Workflow marketplace (6C) | src/models/WorkflowTemplateModel.ts, TemplateVersionModel.ts, MarketplaceListingModel.ts, src/services/marketplaceService.ts | proven patterns: visibility/status lifecycle, version snapshots with content hash, statistics, ranking, reviews |
| PublisherProfileModel | src/models/PublisherProfileModel.ts | publisher identity; extended additively with publisher type + analytics counters |
| RBAC | src/auth/permissions.ts, src/services/permissionService.ts, src/api/middleware/requirePermission.ts | new AGENT_MARKETPLACE_* / AGENT_INSTALL family with its own role map (same pattern as TEMPLATE_* and AI_*) |
| Audit framework | src/services/auditService.ts, src/models/AuditLogModel.ts | marketplace audit actions; sanitized metadata only |
| Approvals | src/services/agent/approvalService.ts, AgentRunModel | unchanged; REQUIRE_APPROVAL tools surface through the existing agent approval queue |
## 3. Gap analysis (what 12.7 closes)

1. **Agents cannot leave their workspace.** AgentModel is workspace-scoped with no listing, publication or discovery concept.
2. **No agent versioning.** AgentModel.version is a monotonic counter without snapshots, so rollback and version comparison are impossible.
3. **No install flow.** Nothing materializes an agent from another workspace, and nothing records what was installed from where.
4. **No marketplace search.** Phase 12.2 exposes per-workspace CRUD only.
5. **No reviews or ratings for agents.** The template marketplace has them; agents do not.
6. **No publisher system for agents.** PublisherProfileModel exists but carries no publisher analytics and is unused by agents.
7. **No governance admission control for packaged agents.** Shared agent definitions are never validated against publishing or installing workspace policies.
8. **No marketplace permissions.** RBAC knows nothing about marketplace read/create/manage or install.
## 4. Architecture

    Agent authoring (12.2)                 Consumer workspace
    AgentModel + AgentService              AgentMarketplace listing (PUBLISHED)
         |                                      |
         | create listing (DRAFT)               | search / details
         v                                      v
    AgentMarketplaceModel  <--- publish --- AgentMarketplaceService
         |   ^                                  |  ^    ^
         |   |                                  |  |    |
         |   +-- AgentVersionModel snapshots ---+  |    +-- AgentReviewModel (verified installs)
         |                                         |
         | governance admission (12.6 engine)      | install (validated)
         v                                         v
    AI_GOVERNANCE policy engine             InstalledAgentModel -> cloned AgentModel (consumer ws)
                                                   |
                                                   +-> execute via 12.2 runner (tool policies + approvals)

Two governance checkpoints, one engine:

1. **Publish** - AIGovernancePolicyService.evaluateRequest(dryRun) with feature AI_AGENT, the agent model and a bounded system-prompt preview: feature entitlement, model access policy and prompt/privacy policy must not DENY; every tool in the snapshot must resolve to a non-DENY workspace tool policy. Failure -> AGENT_MARKETPLACE_POLICY_BLOCKED audit + 403.
2. **Install** - the same engine evaluated for the INSTALLING workspace and the installing user role (feature allowedRoles, model access for the snapshot model). Failure -> 403 with reason codes, audited as AGENT_MARKETPLACE_POLICY_BLOCKED. Validations: workspace permissions, governance policies, tool permissions, required models, dependencies (every tool name must exist in AgentToolRegistry).
## 5. Data models

### 5.1 AgentMarketplaceModel (new) - the listing

Workspace-scoped listing wrapping a source agent. Fields: workspaceId (publisher workspace), agentId, publisherId, name, description, category, tags[], visibility (PUBLIC | PRIVATE | WORKSPACE), status (DRAFT | PUBLISHED | ARCHIVED), icon, documentation, pricing ({ model: FREE | PAID, priceUSD, currency }), statistics ({ views, installs, executions }), installCount, executionCount, rating ({ average, count }), latestVersion, versionCount, agentSnapshot (definition at publish time), createdBy, timestamps.

Indexes: { workspaceId, status }, { status, visibility, category }, tags, rating.average, installCount, text index on name/description/tags. Unique: { workspaceId, agentId } (one listing per source agent).

### 5.2 AgentVersionModel (new) - immutable snapshots

Fields: agentMarketplaceId, versionNumber, agentDefinitionSnapshot ({ name, description, systemPrompt, modelConfig, orchestrationMode, toolsAllowed, requiredPermissions, memoryEnabled }), toolConfiguration (tool policy resolution at publish time), governanceSnapshot ({ checkedAt, reasonCodes, modelChecked }), changeSummary, hash (sha256 of the snapshot), createdBy, createdAt. Unique: { agentMarketplaceId, versionNumber }. Supports version history, rollback (forward-only: rollback creates a NEW version copying the target snapshot) and compareVersions.

### 5.3 InstalledAgentModel (new) - installation records

Fields: workspaceId (consumer), agentMarketplaceId, agentId (local clone), installedVersion, configuration (model/temperature/maxTurns/tool-subset overrides), installedBy, status (ACTIVE | DISABLED | UNINSTALLED), installedAt, updatedAt. Unique: { workspaceId, agentMarketplaceId }. Records are kept after uninstall so the verified-installation rule for reviews survives uninstalls.

### 5.4 AgentReviewModel (new) - reviews

Fields: agentMarketplaceId, userId, workspaceId, rating (1-5), review, createdAt, updatedAt. Unique: { agentMarketplaceId, userId } - one review per user per agent; repeat submissions update the existing review and recompute the listing aggregate.

### 5.5 PublisherProfileModel (extended, additive)

Adds publisherType (INDIVIDUAL | ENTERPRISE), website, stats ({ publishedAgents, totalInstalls, averageRating }). Existing fields (userId, displayName, description, verified) unchanged. Profiles are created on first publish; enterprise publishers set publisherType during provisioning.
## 6. Service design - agentMarketplaceService (singleton, mirrors marketplaceService)

    createListing(workspaceId, userId, input)     agent must exist in the workspace; one listing per agent; status DRAFT
    updateListing(listingId, workspaceId, patch)  publisher-scoped; editable name, description, category, tags, visibility, icon, documentation, pricing
    publishAgent(listingId, workspaceId, userId)  publish governance checkpoint, first AgentVersion when none exists, status PUBLISHED, publisher stats
    archiveAgent(listingId, workspaceId, userId)  PUBLISHED -> ARCHIVED; archived listings leave discovery
    installAgent(listingId, workspaceId, userId, config?)  validates visibility + governance + tools + model + dependencies, clones the agent, records InstalledAgentModel
    uninstallAgent(listingId, workspaceId, userId)  install -> UNINSTALLED, local clone archived, active install count adjusted
    searchAgents(workspaceId, filters, pagination)  text/category/tag/publisher/rating/usage filters; visibility aware (PUBLIC + own WORKSPACE listings; PRIVATE only for their workspace)
    getAgentDetails(listingId, workspaceId)         listing + latest version + publisher profile + install state + recent reviews
    rateAgent(listingId, workspaceId, userId, rating, review?)  requires an ACTIVE installation; upserts the caller review; recomputes aggregate
    compareVersions(listingId, from, to)            structured diff of two snapshots (fields changed, tools added/removed, governance deltas)
    listVersions / rollbackToVersion                rollback creates a NEW version from the target snapshot (forward-only)
    getStats(listingId, workspaceId)                statistics + install count + review count + version count

Deterministic errors (mapped by routes): AGENT_NOT_FOUND, LISTING_NOT_FOUND, LISTING_ALREADY_EXISTS, AGENT_MARKETPLACE_POLICY_BLOCKED, AGENT_ALREADY_INSTALLED, AGENT_NOT_INSTALLED, TOOL_DENIED_BY_POLICY, UNKNOWN_TOOL, REVIEW_REQUIRES_INSTALLATION, INVALID_RATING, INVALID_REQUEST, FORBIDDEN.
## 7. API design - /api/v1/agent-marketplace (new router, one app.ts mount line)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | /agents | AGENT_MARKETPLACE_READ | search/list (q, category, tag, publisher, minRating, sort, page, limit) |
| GET | /search | AGENT_MARKETPLACE_READ | discovery alias of /agents |
| GET | /agents/:id | AGENT_MARKETPLACE_READ | listing details (version, publisher, install state, recent reviews) |
| POST | /agents | AGENT_MARKETPLACE_CREATE | create a listing from a workspace agent |
| PUT | /agents/:id | AGENT_MARKETPLACE_CREATE | update an owned listing |
| POST | /agents/:id/publish | AGENT_MARKETPLACE_CREATE | governance-gated publication |
| POST | /agents/:id/archive | AGENT_MARKETPLACE_MANAGE | archive a listing |
| GET | /agents/:id/versions | AGENT_MARKETPLACE_READ | version history |
| GET | /agents/:id/versions/compare | AGENT_MARKETPLACE_READ | compareVersions (from, to) |
| POST | /agents/:id/rollback | AGENT_MARKETPLACE_MANAGE | forward-rollback to a version snapshot |
| POST | /agents/:id/install | AGENT_INSTALL | validated install into the calling workspace |
| DELETE | /agents/:id/install | AGENT_INSTALL | uninstall |
| POST | /agents/:id/reviews | AGENT_INSTALL | create/update the caller review (verified install required) |
| GET | /agents/:id/reviews | AGENT_MARKETPLACE_READ | paginated reviews |
| GET | /agents/:id/stats | AGENT_MARKETPLACE_READ | listing analytics |

All responses use the `{ data }` envelope; every route is workspace-scoped through the X-Workspace-Id header (requirePermission default resolver) and RBAC protected.
## 8. RBAC, workspace isolation, audit, error codes

- **Permissions** (new family, mirroring TEMPLATE_* / AI_*): AGENT_MARKETPLACE_READ, AGENT_MARKETPLACE_CREATE, AGENT_MARKETPLACE_MANAGE, AGENT_INSTALL. Role map: OWNER/ADMIN all; EDITOR READ + INSTALL; VIEWER READ only. Implemented as a dedicated list + role map in src/auth/permissions.ts (roleHasAgentMarketplacePermission) and dispatched in permissionService.evaluateMembership, so the documented Phase 3B matrix (tests/rbac.test.ts) is untouched.
- **Workspace isolation**: listings, versions, installs, reviews and stats are all filtered by workspaceId or by visibility rules; PRIVATE listings are visible only inside their publishing workspace; installs always write into the calling workspace from the X-Workspace-Id context.
- **New audit actions** (AuditLogModel): AGENT_LISTING_CREATED, AGENT_LISTING_PUBLISHED, AGENT_LISTING_ARCHIVED, AGENT_LISTING_INSTALLED, AGENT_LISTING_UNINSTALLED, AGENT_VERSION_CREATED, AGENT_REVIEW_CREATED, AGENT_MARKETPLACE_POLICY_BLOCKED. Metadata is sanitized (no API keys, no secrets, no private prompt bodies - only pattern ids, codes and counters).
- **Error mapping** (route level, matching enterpriseAgentRoutes conventions): 404 AGENT_NOT_FOUND / LISTING_NOT_FOUND / AGENT_NOT_INSTALLED, 409 LISTING_ALREADY_EXISTS / AGENT_ALREADY_INSTALLED, 403 AGENT_MARKETPLACE_POLICY_BLOCKED / TOOL_DENIED_BY_POLICY / FORBIDDEN, 400 INVALID_REQUEST / INVALID_RATING / UNKNOWN_TOOL.

## 9. Frontend

- `frontend/app/agents/marketplace/page.tsx` -> AgentMarketplaceDashboard (workspace store + permissions aware).
- `frontend/features/agents/marketplace/`: AgentMarketplaceDashboard, AgentCard, AgentDetailsPanel, AgentInstallModal, AgentVersionHistory, AgentReviewPanel, PublisherProfile.
- `frontend/types/agentMarketplace.ts` (DTOs) + `frontend/services/agentMarketplaceApi.ts` (client, `{ data }` envelope, X-Workspace-Id headers).
- Features: search + category filter, agent cards with rating/installs/publisher, details panel (documentation, version history, reviews), install modal (config overrides), review submission for verified installs, Live vs Demo data badge pattern (Promise.allSettled + local fallback) matching the Phase 12 consoles.
- Permissions mirrored in frontend/types/permissions.ts as a new AGENT_MARKETPLACE_PERMISSIONS list + role map + hasPermission support.
## 10. Files

Backend - new:
- src/models/{AgentMarketplaceModel, AgentVersionModel, InstalledAgentModel, AgentReviewModel}.ts
- src/services/agentMarketplaceService.ts
- src/api/routes/agentMarketplaceRoutes.ts

Backend - modified (additive only):
- src/models/PublisherProfileModel.ts (publisherType, website, stats)
- src/models/AuditLogModel.ts (marketplace actions)
- src/auth/permissions.ts (AGENT_MARKETPLACE_PERMISSIONS + role map + helpers)
- src/services/permissionService.ts (dispatch the new permission family)
- src/api/middleware/requirePermission.ts (AnyPermission union)
- src/api/app.ts (one mount line at /api/v1/agent-marketplace)

Frontend - new: frontend/app/agents/marketplace/page.tsx,
frontend/features/agents/marketplace/* (7 components), frontend/types/agentMarketplace.ts,
frontend/services/agentMarketplaceApi.ts. Modified: frontend/types/permissions.ts (mirror).
## 11. Test strategy

Backend - tests/agentMarketplace.test.ts (vitest + MongoMemoryReplSet + supertest + createApp, matching Phase 12 suites):
- create listing (DRAFT), duplicate listing rejected, RBAC (editor cannot create)
- publish: governance-clean agent publishes with version 1; blocked model / disabled AI_AGENT feature / DENY tool policy -> AGENT_MARKETPLACE_POLICY_BLOCKED + audit, listing stays DRAFT
- search: visibility rules (PUBLIC across workspaces, PRIVATE hidden), category/tag/rating filters, pagination
- install: success clones the agent + creates InstalledAgentModel + counters; duplicate install 409; feature policy denial blocks install; blocked model blocks install; unknown tool blocks install
- uninstall: local agent archived, install record UNINSTALLED
- versions: publish update creates version 2; compareVersions returns tool deltas; rollback creates version 3 from the v1 snapshot
- reviews: requires ACTIVE install (403 otherwise), 1-5 validation, one review per user (update path), aggregate recomputed, audit AGENT_REVIEW_CREATED
- stats endpoint, RBAC matrix (viewer read-only, editor read+install, admin manage), workspace isolation

Frontend - frontend/tests/agentMarketplace.test.tsx: dashboard renders cards, install modal submits configuration, review guard requires installation, search filter plumbing.

Regression gates: root typecheck + full vitest (809+), frontend tsc --noEmit + vitest (125+) + next build; existing agent, governance, optimization, template-marketplace and RBAC suites stay green with zero modifications (the new permission family sits outside the documented Phase 3B matrix).
## 12. Backward compatibility and non-goals

- All new collections; existing models only gain optional fields. Agent CRUD, execution, approvals and the 12.6 governance path are untouched.
- The template marketplace (Phase 6C/10) is not modified.
- Non-goals: paid billing/settlement (pricing is metadata only), cross-region listing replication, agent fork/merge semantics, automated safety scanning beyond the 12.6 rule engine.

## 13. Implementation order

1. Models + publisher extension + audit actions
2. Permission family (backend + permissionService + requirePermission union)
3. agentMarketplaceService (listing, publish, install, search, reviews, versions, stats)
4. Routes + app.ts mount
5. Backend tests + full regression
6. Frontend types + API client + components + page + permissions mirror
7. Frontend tests + full frontend verification

## 14. Verification

- `npm run typecheck`; `npm test` (root) - zero regressions, new suite green
- `cd frontend && npm run typecheck && npm test && npm run build`
- Manual smoke: publish an agent, install it into a second workspace, verify the cloned agent runs, leave a review, roll it back.