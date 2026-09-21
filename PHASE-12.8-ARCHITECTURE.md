# Phase 12.8 - Enterprise AI Agent Marketplace Intelligence & Operations (Architecture Plan)

Status: Implemented and verified - analytics, health scoring, governance-aware recommendations, lifecycle automation with publisher notifications, four intelligence endpoints and the Intelligence tab plus publisher analytics page are live (backend 835/835, frontend 143/143, root + next builds green).
Branch: phase-2e-production-hardening
Depends on: 12.7 Agent Marketplace (listings, versions, installs, reviews), 12.2 Agent Platform (AgentRunModel telemetry, execution), 12.6 AI Governance (policy engine + gate), notification framework (NotificationService), audit framework, RBAC.

## 1. Goal

Extend the marketplace from a functional distribution system into an intelligent operational platform: operators see how agents are adopted, publishers get actionable analytics and notifications, workspaces receive governance-aware recommendations, and every listing carries a health score derived from real execution telemetry - all inside the existing workspace isolation, RBAC, governance and audit constraints.

Capabilities:
1. Marketplace analytics (installs over time, active installations, adoption, publisher analytics, workspace usage insights)
2. Agent health scoring (version adoption, failure rate, tool execution errors, policy violations, review trends)
3. Recommendation engine (usage patterns, enabled features, installed agents, permissions, governance constraints)
4. Lifecycle automation (deprecated version warnings, update recommendations, inactive agent detection, publisher notifications)
## 2. Reuse map (existing components leveraged)

| Existing component | Location | 12.8 usage |
| --- | --- | --- |
| AgentMarketplaceModel / AgentVersionModel / InstalledAgentModel / AgentReviewModel | src/models/* | read-only sources for analytics, health, recommendations and lifecycle (no schema changes) |
| agentMarketplaceService | src/services/agentMarketplaceService.ts | visibility + listing access rules reused; 12.8 adds a sibling intelligence service instead of duplicating logic |
| AgentRunModel | src/models/AgentRunModel.ts | execution telemetry: status, toolCalls (SUCCEEDED/FAILED/DENIED), createdAt/completedAt drive failure rate, tool error rate, usage insights and inactivity detection |
| AgentModel + AgentService | src/models/AgentModel.ts | local clones of installed agents are the join key between installs and runs |
| AIGovernancePolicyService | src/services/aiGovernancePolicyService.ts | governance checks for recommendations and lifecycle (feature entitlement, model access, role allow-lists), evaluated per distinct candidate model |
| AIFeaturePolicyModel / AIModelAccessPolicyModel | src/models/AIGovernancePolicyModel.ts | pre-filter candidates; denial reasons surfaced in responses |
| AuditLogModel + createAuditLog | src/services/auditService.ts | three new actions; metadata sanitized, no prompt bodies |
| NotificationService + NotificationModel | src/services/notificationService.ts | publisher notifications (type SYSTEM) with 24h dedupe per listing + event |
| requirePermission + AGENT_MARKETPLACE_* family | src/api/middleware/requirePermission.ts, src/auth/permissions.ts | all four endpoints RBAC protected with the 12.7 permission family; no new permissions needed |
| agentMarketplaceRoutes | src/api/routes/agentMarketplaceRoutes.ts | new endpoints added to the same router (single mount, shared error mapping) |
| Marketplace console + API client + DTOs | frontend/features/agents/marketplace/*, frontend/services/agentMarketplaceApi.ts | extended with an Intelligence tab, health indicators, recommendation feed, update notifications and a publisher analytics page |
## 3. Migration impact analysis

**Schema impact: none.** No new collections and no new fields on existing models. All intelligence is derived from AgentMarketplace, AgentVersion, InstalledAgent, AgentReview, AgentRun, AuditLog and Notification data that 12.2/12.7 already write, so existing documents remain valid.

**New indexes: none required.** Every query uses existing indexes:
- InstalledAgentModel: { workspaceId, agentMarketplaceId } unique and { workspaceId, status }
- AgentRunModel: { workspaceId, agentId, createdAt } and { workspaceId, status }
- AgentReviewModel: { agentMarketplaceId, createdAt }
- AgentMarketplaceModel: { workspaceId, status }, { status, visibility, category }, rating.average, installCount
- AuditLogModel: { workspaceId, createdAt }

**Behavioural impact on 12.7: additive only.**
- GET /agents/:id/stats keeps its shape; analytics live on a new endpoint.
- Publish/install governance checkpoints are untouched; the new endpoints read policy state and report blocked candidates instead of weakening the gate.
- Lifecycle notifications are the only write introduced by 12.8 (NotificationModel, type SYSTEM). They are workspace-scoped, deduplicated per listing + event in a rolling 24h window, and never created for listings the caller cannot see.

**Audit/notification volume:** the new endpoints emit one summary audit record per call (counts and reason codes only), never per-listing records, so audit growth stays bounded.

**Test impact:** no existing suite changes; 12.7 suites must stay green with zero modifications. New coverage lives in tests/agentMarketplaceIntelligence.test.ts and frontend/tests/agentMarketplaceIntelligence.test.tsx.
## 4. Architecture

    AgentRunModel (execution telemetry) ---+
    InstalledAgentModel (installs) --------+--> marketplaceIntelligenceService
    AgentMarketplaceModel (listings) ------+        |
    AgentVersionModel / AgentReviewModel --+        |-- getAnalytics()       -> GET /analytics
    AuditLogModel (policy blocks) ---------+        |-- getHealth()          -> GET /health
                                                    |-- getRecommendations() -> GET /recommendations
    AIGovernancePolicyService ----------------------|-- getLifecycle()       -> GET /lifecycle
      (feature + model access checks)               |
                                                    +--> audit summary records
                                                    +--> publisher notifications (SYSTEM, 24h dedupe)
## 5. Analytics design (getAnalytics)

Workspace (consumer) section:
- activeInstallations: InstalledAgentModel { workspaceId, status ACTIVE }
- executionsInWindow: AgentRunModel for the workspace's installed local agents, bucketed by day
- unusedAgents: active installs whose local agent has zero runs in the window
- topAgentsByExecutions: top 5 local agents with run counts and failure counts

Publisher section (listings published by this workspace):
- installsOverTime: InstalledAgentModel records whose listing belongs to the workspace, bucketed per day (UTC), zero-filled across the window
- totals: installs (lifetime), activeInstalls, published/draft/archived counts, ratings
- adoption: executions on installed clones per funded install (executions / installs, zero-safe)
- perListing: installs, activeInstalls, executions, rating, versionCount (the publisher analytics table)

Timeframes: 7d | 30d (default) | 90d. All aggregation is $match-scoped by workspaceId or by listing ids owned by the workspace.

## 6. Agent health scoring (getHealth)

Signals (last 30d unless noted):
- versionAdoption: active installs on the latest published version / active installs
- failureRate: FAILED runs / completed runs across installed clones of the listing
- toolErrorRate: toolCalls with status FAILED or DENIED / total toolCalls
- policyViolations: AGENT_MARKETPLACE_POLICY_BLOCKED audit records referencing the listing
- reviewTrend: average rating in the last 30d minus the previous 30d window

Score (0-100, clamped) = 100 - failureRate*35 - toolErrorRate*20 - min(policyViolations,5)*4 - (1 - versionAdoption)*25 - reviewPenalty, where reviewPenalty = max(0, 4 - recentAverage) * 6.
Bands: HEALTHY >= 80, WATCH >= 60, AT_RISK < 60. Signals are returned alongside the score for explainability; listings with fewer than 3 completed runs report confidence LOW.
## 7. Recommendation engine (getRecommendations)

Pipeline:
1. **Candidate set** - PUBLISHED listings visible to the workspace (PUBLIC + own WORKSPACE/PRIVATE), excluding ACTIVE installations.
2. **Governance filter (hard)** - for every distinct candidate model, AIGovernancePolicyService.evaluateRequest(feature AI_AGENT, role, model, dryRun) is evaluated once (cached per model). Any DENY removes the candidate and is reported in blockedByGovernance with the reason codes, so a blocked model can never be recommended. Feature-level denial (AI_AGENT disabled or role not allowed) short-circuits to an empty list with the policy reason.
3. **Scoring** - affinity from category overlap with installed/executed agents (+30), tag overlap (+15), rating (up to +20), popularity (log-scaled installs, up to +15), publisher diversity (+5 when that publisher has no installed agents yet), recency (up to +10).
4. **Permission shaping** - items carry installable (role holds AGENT_INSTALL via the shared role map) and reasons; viewers still receive the feed read-only.
5. **Audit** - one MARKETPLACE_RECOMMENDATIONS_VIEWED record per call with candidate/excluded counts.
## 8. Lifecycle automation (getLifecycle)

Installer events (per ACTIVE/DISABLED install):
- UPDATE_AVAILABLE when installedVersion < listing.versionCount (recommended action: install the new version)
- DEPRECATED_VERSION when the installed version is at least two versions behind the latest
- LISTING_ARCHIVED when the publisher archived the listing
- INACTIVE_AGENT when the local clone has no runs in the last 30 days

Publisher events (per PUBLISHED listing owned by the workspace):
- INACTIVE_LISTING when the listing has no installs and no executions in the last 30 days
- STALE_PUBLICATION when no new version was published in the last 90 days

Publisher notifications: for every publisher event (and installer UPDATE_AVAILABLE events), a SYSTEM notification is created for the publisher user with a 24h dedupe key of (resourceId, type, event). Notification creation is best-effort (failures are swallowed) and never blocks the response.

Audit: one AGENT_LIFECYCLE_EVENT_TRIGGERED record per scan with event-type counts and the notified count.

## 9. RBAC, audit, error codes

- All four endpoints require AGENT_MARKETPLACE_READ (no new permissions); workspace scoping uses the X-Workspace-Id resolver exactly like 12.7.
- New audit actions: MARKETPLACE_RECOMMENDATIONS_VIEWED, AGENT_HEALTH_EVALUATED, AGENT_LIFECYCLE_EVENT_TRIGGERED.
- Errors reuse the 12.7 mapping (LISTING_NOT_FOUND 404, INVALID_REQUEST 400, AGENT_MARKETPLACE_POLICY_BLOCKED 403 for a feature-level denial on the recommendations endpoint).
## 10. API design (added to the existing /api/v1/agent-marketplace router)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | /analytics?timeframe=30d | AGENT_MARKETPLACE_READ | workspace + publisher analytics bundle |
| GET | /recommendations?limit=5 | AGENT_MARKETPLACE_READ | governance-filtered recommendation feed |
| GET | /health?listingId= | AGENT_MARKETPLACE_READ | health scores (all visible listings or one listing) |
| GET | /lifecycle | AGENT_MARKETPLACE_READ | lifecycle scan + publisher notifications |

Responses keep the { data } envelope; workspace scoping comes from X-Workspace-Id.

## 11. Frontend

- Types: frontend/types/agentMarketplace.ts gains analytics/health/recommendation/lifecycle DTOs.
- Client: agentMarketplaceApi gains getAnalytics, getHealth, getRecommendations, getLifecycle.
- Components (frontend/features/agents/marketplace/):
  - MarketplaceAnalyticsPanel - KPI row, installs-over-time bars, adoption metrics, workspace usage
  - AgentHealthIndicator - band badge + score with signal details
  - RecommendationFeed - ranked cards with reasons and install CTA (read-only for viewers)
  - LifecycleNotifications - update-available, deprecated and inactive warnings
  - PublisherAnalyticsPanel - per-listing publisher table and totals
- Pages: /agents/marketplace gains a Discover | Intelligence tab switch (analytics + recommendations + lifecycle); /agents/marketplace/publisher is the publisher analytics page.
## 12. Test strategy

Backend - tests/agentMarketplaceIntelligence.test.ts (MongoMemoryReplSet + supertest + createApp):
- analytics correctness: seeded installs across days produce a zero-filled time series; workspace and publisher scoping; unrelated workspaces excluded
- health: seeded runs (success/failure), denied tools, policy-block audits and reviews produce the expected bands and signals
- recommendations: installed agents excluded; model-blocked candidates excluded with reason codes; disabled AI_AGENT feature short-circuits; viewer receives a read-only feed (installable false)
- lifecycle: UPDATE_AVAILABLE / DEPRECATED_VERSION / INACTIVE_AGENT / INACTIVE_LISTING detection; publisher notification created once across two scans (24h dedupe)
- API authorization: viewer read allowed; non-member hidden 404; audit records emitted per endpoint
- governance bypass prevention: a model blocked by workspace policy is never present in recommended items, and installing such an agent stays blocked (12.7 behaviour intact)

Frontend - frontend/tests/agentMarketplaceIntelligence.test.tsx:
- component tests for analytics KPIs, health indicators, recommendation feed, lifecycle notifications and the publisher table
- API integration tests for the four new client methods (paths, params, workspace header, envelope unwrap)
- route validation: /agents/marketplace and /agents/marketplace/publisher render with mocked services

## 13. Non-goals

- No new collections, no schema or index changes, no new permissions.
- No ML/LLM ranking (deterministic scoring only).
- No billing or paid-pricing analytics (pricing remains metadata).
- No cross-workspace notification fan-out beyond the publisher of a listing.

## 14. Implementation order and verification

1. Audit actions (additive)
2. marketplaceIntelligenceService (analytics, health, recommendations, lifecycle + notifications)
3. Routes (4 endpoints) with RBAC + audit
4. Backend tests + full regression
5. Frontend DTOs, client methods, components, tabs, publisher page, tests
6. Verification: root typecheck + npm test; cd frontend && typecheck + test + build