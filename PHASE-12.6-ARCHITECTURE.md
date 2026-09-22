# Phase 12.6 - Enterprise AI Governance Expansion (Architecture Plan)

Status: Implemented and verified - policy engine, governance gate, governed provider factory, call-site enforcement across Phase 12 services, policy/audit/approval APIs, agent tool policy persistence and the tabbed governance console are live and green (backend 809/809, frontend 125/125).
Branch: phase-2e-production-hardening
Depends on: 12.1 AI Copilot, 12.2 Agent Platform, 12.3 Self-Healing, 12.4 Predictive Intelligence, 12.5 Workflow Optimization, Module 12C (AI Governance & Multi-Model Router).

## 1. Goal

Extend the Module 12C governance foundation into an enforceable control plane for *every* AI
operation in a workspace:

- AI model access policies (provider/model allow/deny per role, premium-model gating)
- Prompt governance (configurable banned patterns, injection handling, length limits)
- AI feature permissions (per-feature role entitlements, replacing workspace-wide booleans)
- Token/cost limits (workspace caps enforced + per-user/role/feature usage limits)
- Data privacy rules (per-category PII handling: ALLOW / REDACT / BLOCK)
- Human approval requirements (policy-driven REQUIRE_APPROVAL with a unified AI approvals queue)
- AI audit dashboard (spend, denials, redactions, throttles, approvals from real telemetry)

Design principle: additive and opt-in. Workspaces with no policies configured keep todays
behavior; the one intentional behavior change is that existing budget thresholds (already
advertised in the console) become enforced.
## 2. Analysis of existing assets (reused, not rebuilt)

| Asset | Location | Role in 12.6 |
| --- | --- | --- |
| AIConfigurationModel | src/models/AIConfigurationModel.ts | provider/API-key config; features{} becomes the fallback entitlement when no feature policy row exists |
| AIUsageModel | src/models/AIUsageModel.ts | usage metering; windowed aggregates power per-user/per-feature limits and the audit dashboard |
| AIGovernanceBudgetModel + AIGovernanceService | src/models/AIGovernanceBudgetModel.ts, src/services/ai/aiGovernanceService.ts | workspace token/cost caps with alert/throttle/block thresholds; 12.6 adds a read-only state helper and finally enforces it |
| AIModelRouterConfigModel + AIModelRouter | src/models/AIModelRouterConfigModel.ts, src/services/ai/aiModelRouter.ts | routing surface untouched; THROTTLE outcomes reuse its cost-optimization path |
| AISecurityService | src/services/ai/aiSecurityService.ts | single source of truth for prompt validation, sanitization, sensitive-data patterns |
| AuditLogModel + auditQueryService | src/models/AuditLogModel.ts, src/services/auditQueryService.ts | decision auditing and the events feed behind the AI audit dashboard |
| ApprovalRequestModel + ApprovalService | src/models/ApprovalRequestModel.ts, src/services/agent/approvalService.ts | shared approval workflow; 12.6 adds the AI_OPERATION resource type |
| Agent tool policies | src/services/agent/agentToolPolicyService.ts, agentToolInvocation.ts | ALLOW/DENY/REQUIRE_APPROVAL per tool; 12.6 persists overrides and consults them in the engine |
| Self-healing policies | src/models/SelfHealingPolicyModel.ts | risk/requiresApproval semantics reused as inputs to approval decisions |
| Optimization approvals | src/services/autonomousOptimizationService.ts (12.5) | plan approvalRequired consults the new approval policy |
| Governance console | frontend/app/platform/ai-governance/page.tsx, services/aiGovernanceApi.ts | extended with policy tabs and the AI audit dashboard |
## 3. Gap analysis (what 12.6 closes)

1. **No enforcement.** AIGovernanceService.updateUsageAndCheckThresholds is never called from
   AI call sites; every AI service (workflow gen, copilot, failure analysis, optimization,
   12.5, self-healing, agents, business/ops assistants) calls AIProviderFactory directly and
   records usage post-hoc. Budget thresholds are advisory only.
2. **No model access policies.** Any user with an AI feature permission can use any provider
   and model configured for the workspace, including premium tiers.
3. **Feature entitlements are workspace-wide booleans** (AIConfigurationModel.features).
   There is no per-role or per-feature policy (who may use which feature, at which tier).
4. **Prompt governance is advisory.** Injection/PII helpers exist (AISecurityService,
   duplicated in AIGovernanceService) but reachable only via POST /sanitize; no configurable
   workspace rules, no block-vs-redact policy, no enforcement in the request path.
5. **No data privacy rules.** PII handling is hardcoded regex redaction; no per-category
   ALLOW/REDACT/BLOCK policy, no output-side handling, no redaction accounting.
6. **Approvals are per-module, not policy-driven.** Agent tools, self-healing incidents and
   12.5 optimization plans each gate themselves; there is no workspace policy that says
   "approvals are required for feature X / cost above Y / premium model Z", and no unified
   AI approvals queue.
7. **No AI audit dashboard.** The console shows demo redaction/injection counters; nothing
   aggregates real AI audit events, spend per feature/model, denials, or approval backlog.
8. **Agent tool policy overrides are in-memory** (lost on restart) and are not part of the
   governance configuration surface.
## 4. AI Governance architecture

    AI call sites (workflow gen, copilot, failure analysis, optimization, 12.5, self-healing,
    agents, assistants)
        -> AIGovernanceGate.authorize(context)            [new - enforcement wrapper]
            -> AIGovernancePolicyService.evaluate()       [new - policy engine, single decision point]
                1. Feature entitlement   AIFeaturePolicyModel (fallback: AIConfigurationModel.features)
                2. Role entitlement      allowedRoles per feature (uses existing AI_* permissions)
                3. Model access          AIModelAccessPolicyModel (blocked models, role allow-lists,
                                         premium-tier approval gate)
                4. Prompt governance     PromptGovernancePolicyModel (length, banned patterns,
                                         injection handling: BLOCK | REDACT | FLAG)
                5. Data privacy          AIDataPrivacyRuleModel (per-category ALLOW | REDACT | BLOCK)
                6. Quota & budget        AIUsageLimitModel (windowed usage from AIUsageModel) +
                                         AIGovernanceBudgetModel (workspace caps)
                7. Approval policy       AIApprovalPolicyModel -> REQUIRE_APPROVAL + ApprovalRequest
            -> decision: ALLOW | ALLOW_REDACTED | THROTTLE | REQUIRE_APPROVAL | DENY
            -> audit (AuditLogModel) + usage metering + optional approval request

Precedence: DENY > REQUIRE_APPROVAL > ALLOW_REDACTED > THROTTLE > ALLOW.
Every evaluation is workspace-scoped; policies are per-workspace singleton documents.
### Decision semantics

- **ALLOW** - operation proceeds unchanged.
- **ALLOW_REDACTED** - operation proceeds with decision.sanitizedPrompt; callers MUST use it
  in place of the original prompt. Redaction events are audited.
- **THROTTLE** - operation proceeds but the gate forces cost-optimized routing (cheapest
  allowed model). Used when a usage limit action is THROTTLE. Audited as AI_OPERATION_THROTTLED.
- **REQUIRE_APPROVAL** - the gate creates an ApprovalRequest (resourceType AI_OPERATION,
  resourceId = operationId) and returns a pending decision. Callers surface "approval required"
  exactly like 12.2 tool approvals and 12.5 plan approvals. On retry the caller passes the
  approved approvalId; the engine validates APPROVED + not expired and allows.
- **DENY** - no provider call. Error code AI_GOVERNANCE_DENIED (403) with structured reasons.
  Audited as AI_OPERATION_DENIED.

### Enforcement points

1. **AIGovernanceGate** (new, src/services/ai/aiGovernanceGate.ts) - the wrapper services call:
   authorize(context) -> decision, and runGoverned(context, executor) for a one-call path that
   also audits + meters. Used where user/role context is available (all Phase 12 services).
2. **AIProviderFactory.getGovernedProviderForWorkspace(context)** - additive factory method that
   (a) enforces workspace budget BLOCK, (b) applies model access policy when model/provider is
   explicit, (c) returns the decision alongside provider/model so services can honor THROTTLE.
   The existing getProviderForWorkspace stays untouched for backward compatibility.
3. **Approval integration** - ApprovalRequestModel.APPROVAL_RESOURCE_TYPES gains 'AI_OPERATION';
   ApprovalService is reused as-is. Approval decisions are audited and exposed in the AI
   approvals queue endpoint.
4. **Analytics feedback** - every decision emits sanitized audit metadata; dashboard aggregates
   read AuditLogModel + AIUsageModel, never raw prompts.
## 5. Database models

All new models are workspace-scoped singleton documents (unique index on workspaceId), 1:1 with
the existing AIGovernanceBudgetModel pattern.

### 5.1 New models

| Model | Key fields | Purpose |
| --- | --- | --- |
| AIModelAccessPolicyModel | allowedProviders[], allowedModels[], blockedModels[], roleRestrictions (per-role allow-lists), premiumModelApprovalRequired, premiumModelPatterns[] | provider/model access control; premium-tier gating |
| AIFeaturePolicyModel | features: Record<AIFeatureType, { enabled, allowedRoles[], requiresApproval }> | per-feature role entitlements (supersedes AIConfigurationModel.features when present) |
| PromptGovernancePolicyModel | maxPromptLength, bannedPatterns[{ id, label, pattern, action: BLOCK\\|REDACT\\|FLAG }], injectionAction, allowCustomSystemPrompts, auditAllAllows | configurable prompt rules; audit verbosity control |
| AIDataPrivacyRuleModel | categories: { email, phone, ssn, creditCard, apiKey, bearerToken, privateKey, password } -> ALLOW\\|REDACT\\|BLOCK, redactOutputs, storeRedactedPayloads | per-category PII handling policy |
| AIUsageLimitModel | scope: USER\\|ROLE\\|FEATURE, scopeValue, window: DAILY\\|MONTHLY, tokenLimit, costLimitUSD, action: ALERT\\|THROTTLE\\|BLOCK | granular usage limits; usage is computed from AIUsageModel aggregates (no counter drift) |
| AIApprovalPolicyModel | rules[{ id, enabled, condition { features?, minEstimatedCostUSD?, modelTiers? (premium/standard), flaggedPrompt?, minRiskLevel? }, requiredRoles[], minApprovers }] | when AI operations require human approval |
| AgentToolPolicyModel | workspaceId, toolName, policy: ALLOW\\|DENY\\|REQUIRE_APPROVAL, updatedBy | persists agent tool overrides (today in-memory only) |

### 5.2 Extended existing models (additive only)

- ApprovalRequestModel: APPROVAL_RESOURCE_TYPES + 'AI_OPERATION'.
- AuditLogModel: new actions (section 9). No removals.
- AIUsageModel: unchanged (windowed aggregates via existing indexes).
- AIConfigurationModel: unchanged (features{} remains the fallback entitlement).
## 6. Policy engine design

New service: src/services/ai/aiGovernancePolicyService.ts (singleton, mirrors existing AI
service patterns).

    interface AIGovernanceContext {
      workspaceId: string;
      userId?: string;
      role?: WorkspaceRole;
      feature: AIFeatureType;
      operationId?: string;        // stable id for approval round-trips
      provider?: 'openai' | 'anthropic' | 'mock';
      model?: string;
      prompt?: string;
      estimatedTokens?: number;
      estimatedCostUSD?: number;
      riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
      approvalId?: string;         // provided on retry after approval
    }

    interface AIGovernanceDecision {
      outcome: 'ALLOW' | 'ALLOW_REDACTED' | 'THROTTLE' | 'REQUIRE_APPROVAL' | 'DENY';
      reasons: Array<{ code: string; policy: string; message: string }>;
      sanitizedPrompt?: string;
      matchedPatterns?: string[];
      approvalId?: string;
      requiredRoles?: WorkspaceRole[];
      throttleModel?: string;
      evaluatedAt: Date;
    }
Evaluator rules (each is a private step, deterministic order, first DENY short-circuits):

- Feature: no policy row -> fall back to AIConfigurationModel.features (today's behavior);
  policy row -> enabled + allowedRoles (workspace-role-agnostic when role is absent).
- Model access: blockedModels match -> DENY; role allow-list present and model absent -> DENY;
  premium pattern match -> REQUIRE_APPROVAL when premiumModelApprovalRequired is set.
- Prompt: length > maxPromptLength -> DENY (AI_GOVERNANCE_PROMPT_BLOCKED); banned pattern
  actions: BLOCK -> DENY, REDACT -> sanitizedPrompt, FLAG -> reason only; injection handling
  mirrors AISecurityService patterns (single source of truth) with the configured action.
- Privacy: category detectors (regexes live in AISecurityService, extended with a category map);
  BLOCK category hit -> DENY; REDACT -> sanitizedPrompt; the output-side redaction flag is
  reported in the decision for callers that post-process model responses.
- Quota: budget state from AIGovernanceBudgetModel (block -> DENY AI_GOVERNANCE_QUOTA_BLOCKED,
  throttle -> THROTTLE) plus each matching AIUsageLimitModel evaluated against windowed
  AIUsageModel aggregates (DAILY = 24h, MONTHLY = current month); ALERT adds a reason.
- Approval: matching AIApprovalPolicyModel rule -> REQUIRE_APPROVAL; when approvalId is
  provided, validate ApprovalRequest APPROVED + not expired -> ALLOW (recorded).
## 7. API design

Extend the existing `/api/v1/ai/governance` mount (new router file
src/api/routes/aiGovernancePolicyRoutes.ts, mounted alongside the existing router - no app.ts
path changes beyond one line).

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | /posture | AI_GOVERNANCE_READ | consolidated posture: policy presence, budget state, active limits, approval backlog |
| GET \\| PUT | /model-access | AI_GOVERNANCE_READ \\| AI_GOVERNANCE_MANAGE | model access policy |
| GET \\| PUT | /features | AI_GOVERNANCE_READ \\| AI_GOVERNANCE_MANAGE | per-feature role entitlements |
| GET \\| PUT | /prompt-policy | AI_GOVERNANCE_READ \\| AI_GOVERNANCE_MANAGE | prompt governance policy |
| GET \\| PUT | /privacy-rules | AI_GOVERNANCE_READ \\| AI_GOVERNANCE_MANAGE | PII category handling |
| GET \\| POST | /usage-limits | AI_GOVERNANCE_READ \\| AI_GOVERNANCE_MANAGE | list / create limits |
| PUT \\| DELETE | /usage-limits/:id | AI_GOVERNANCE_MANAGE | update / delete limit |
| GET \\| PUT | /approval-policy | AI_GOVERNANCE_READ \\| AI_GOVERNANCE_MANAGE | approval rules |
| POST | /evaluate | AI_GOVERNANCE_READ | dry-run evaluation (no side effects, audited) |
| GET | /approvals | AI_GOVERNANCE_READ | AI_OPERATION approval queue (status filter) |
| POST | /approvals/:id/decide | AI_GOVERNANCE_MANAGE | APPROVE / REJECT with reason |
| GET | /audit/summary | AI_GOVERNANCE_READ | timeframe aggregates: spend/tokens by feature+model, denial/redaction/throttle/approval counts |
| GET | /audit/events | AI_GOVERNANCE_READ | recent AI audit events (action, user, metadata), paginated |

Notes: no new RBAC permissions (reuse AI_GOVERNANCE_READ/MANAGE). All responses use the `{ data }`
envelope and X-Workspace-Id scoping, matching every Phase 12 route.
## 8. Frontend admin console

Rework `frontend/app/platform/ai-governance/page.tsx` into a tabbed Enterprise AI Governance
console. Existing "_Budget & Routing_" content (AIGovernanceBudgetCard + dynamic model router
card) becomes the first tab and keeps working as-is.

New tab **Policies** (new `frontend/features/ai-governance/` components):
- ModelAccessPolicyPanel - provider/model allow-lists, blocked models, per-role restrictions, premium gate toggle
- FeaturePolicyPanel - per-feature enabled/allowedRoles/requiresApproval matrix
- PromptPolicyPanel - max length, banned pattern editor (label + regex + action), injection action, audit-all-allows toggle
- PrivacyRulesPanel - PII category action matrix, output redaction, redacted payload storage
- UsageLimitsPanel - CRUD table (scope, scopeValue, window, limits, action) with current usage
- ApprovalPolicyPanel - rule builder (features, min cost, model tier, flagged prompt, roles, minApprovers)

New tab **AI Audit** (AIAuditDashboard component):
- KPI row: spend, tokens, denials, redactions, throttles, pending approvals (from /audit/summary)
- Spend by feature and by model (simple bars), recent events table with outcome badges

Plus GovernancePostureCard in the header area (policy coverage + budget state + approval backlog).

Service/types: extend `frontend/services/aiGovernanceApi.ts` and add
`frontend/types/aiGovernancePolicy.ts` (DTOs), mapper helpers following
aiOperationsMappers conventions. Keep the Live API Telemetry vs Demo Data badge pattern
(Promise.allSettled + local fallback) used by both existing consoles.
## 9. RBAC, workspace isolation, audit actions, error codes

- **RBAC**: no new permissions. Read surface (policies, posture, audit, approvals queue) requires
  AI_GOVERNANCE_READ; all mutations and approval decisions require AI_GOVERNANCE_MANAGE.
  Roles unchanged: OWNER/ADMIN manage, EDITOR read, VIEWER read (existing matrix).
- **Workspace isolation**: every policy/limit/approval/audit query is scoped by workspaceId;
  approvals resolve via ApprovalService (already workspace-checked); the engine rejects contexts
  whose workspace does not exist (WORKSPACE_NOT_FOUND).
- **New audit actions** (AuditLogModel): AI_GOVERNANCE_POLICY_UPDATED, AI_OPERATION_EVALUATED,
  AI_OPERATION_DENIED, AI_OPERATION_REDACTED, AI_OPERATION_THROTTLED,
  AI_OPERATION_APPROVAL_REQUESTED, AI_OPERATION_APPROVAL_DECIDED, AGENT_TOOL_POLICY_UPDATED.
  Metadata is sanitized (AISecurityService.sanitizeMetadata/filterSensitiveData); raw prompts are
  never stored - only previews, pattern ids and decision codes. Plain ALLOW events are audited
  only when PromptGovernancePolicyModel.auditAllAllows is enabled (default false).
- **New error codes** (errorHandler): AI_GOVERNANCE_DENIED 403, AI_GOVERNANCE_APPROVAL_REQUIRED
  403, AI_GOVERNANCE_PROMPT_BLOCKED 422, AI_GOVERNANCE_QUOTA_BLOCKED 429,
  AI_GOVERNANCE_POLICY_NOT_FOUND 404, INVALID_GOVERNANCE_POLICY 400.
## 10. Files

Backend - new:
- src/models/{AIModelAccessPolicyModel, AIFeaturePolicyModel, PromptGovernancePolicyModel,
  AIDataPrivacyRuleModel, AIUsageLimitModel, AIApprovalPolicyModel, AgentToolPolicyModel}.ts
- src/services/ai/aiGovernancePolicyService.ts (engine)
- src/services/ai/aiGovernanceGate.ts (enforcement wrapper + runGoverned)
- src/services/ai/aiAuditService.ts (dashboard aggregations)
- src/api/routes/aiGovernancePolicyRoutes.ts

Backend - modified:
- src/models/ApprovalRequestModel.ts (AI_OPERATION resource type)
- src/models/AuditLogModel.ts (8 new actions)
- src/services/ai/aiGovernanceService.ts (budget-state helper; delegate sanitize/injection to
  AISecurityService; consolidate the duplicated AIFeatureType)
- src/services/ai/AIProviderFactory.ts (getGovernedProviderForWorkspace)
- src/services/ai/aiModelRouter.ts (accept THROTTLE override; unchanged by default)
- Call sites: aiWorkflowService, aiOptimizationService, autonomousOptimizationService (12.5),
  aiFailureAnalysisService, aiCopilotService, selfHealingService, aiOperationsAssistantService,
  aiBusinessAssistantService, agent/agentRunnerService, agent/agentToolRegistry
- src/services/agent/agentToolPolicyService.ts (persist via AgentToolPolicyModel + cache hydration)
- src/api/app.ts (mount new router), src/api/middleware/errorHandler.ts (error codes)

Frontend - new: frontend/features/ai-governance/* panels + AIAuditDashboard + GovernancePostureCard,
frontend/types/aiGovernancePolicy.ts. Modified: app/platform/ai-governance/page.tsx (tabs),
services/aiGovernanceApi.ts (+ methods), aiOperationsMappers.ts (new mappers).
## 11. Test strategy

Backend (vitest + MongoMemoryReplSet, matching existing Phase 12 test conventions):

1. tests/aiGovernance.test.ts ("policy evaluation engine" suite) - engine behavior (the planned
   tests/aiGovernancePolicy.test.ts file was not split out):
   - default-permissive fallbacks (no policy rows = today's behavior)
   - feature entitlement per role; disabled feature denies
   - model access: blocked model denies, role allow-list denies, premium pattern yields REQUIRE_APPROVAL
   - prompt: max length denies; banned pattern BLOCK/REDACT/FLAG; injection handling per action
   - privacy: BLOCK category denies; REDACT category returns sanitizedPrompt; ALLOW untouched
   - quota: budget block denies; usage-limit thresholds (ALERT/THROTTLE/BLOCK) with windowed
     AIUsageModel fixtures for DAILY and MONTHLY windows
   - approval round-trip: REQUIRE_APPROVAL creates ApprovalRequest; approved retry allows;
     rejected remains denied; expired approval re-requires approval
   - workspace isolation across every policy type
2. tests/aiGovernance.test.ts - enforcement path, route tests, and agent-tool-policy persistence (consolidated; the separately planned aiGovernanceEnforcement / aiGovernanceApi / agentToolPolicyPersistence files were not split out):
   - governed provider factory: DENY prevents provider invocation (spy on mock provider)
   - ALLOW_REDACTED passes sanitized prompt to the provider
   - budget BLOCK blocks even for otherwise-allowed operations
   - audit entries emitted for denied/redacted/throttled/approved outcomes only
   - Route/RBAC surface (covered in tests/aiGovernance.test.ts above — enforcement, route
     tests, persistence): permission matrix (READ vs MANAGE 403s), policy CRUD happy paths,
     evaluate dry-run has no side effects, approvals queue decide flow, audit summary/events
     scoping + timeframe.

Frontend: frontend/tests/aiGovernanceServices.test.ts - new API client methods (paths, headers,
envelopes) + mapper round-trips.

Regression gates: root `npm run typecheck` + full vitest (791+ tests), frontend `tsc --noEmit` +
vitest (116+ tests). Existing aiModelRouter/aiSecurity/aiRoutes suites must stay green with zero
modifications.
## 12. Backward compatibility and migration

- New models and audit actions are purely additive; no schema-breaking changes.
- AIGovernanceBudget enforcement is the single intentional behavior change: thresholds already
  advertised in the console become real (BLOCK denies with AI_GOVERNANCE_QUOTA_BLOCKED).
  Workspaces below thresholds are unaffected.
- Existing services keep their signatures; the governed path is opt-in per call site and defaults
  to ALLOW when no policies exist, so 12.1-12.5 test suites are expected to stay green.
- Sanitization consolidation (AIGovernanceService -> AISecurityService) keeps static method
  signatures, so existing tests and the /sanitize route are unaffected.
- No new RBAC permissions, so permission matrices and their tests are untouched.

## 13. Non-goals (this phase)

- Output-side (model response) redaction enforcement: the decision reports the configured flag,
  but provider-layer output rewriting is deferred (documented follow-up).
- Policy versioning, effective dates, and draft/publish flows for policies.
- Data-residency routing for AI providers (Phase 10 covers residency policy; 12.6 does not enforce it).
- Real-time budget reservation ledger (metering stays post-hoc/optimistic).
- LLM-judge based prompt evaluation (rules + regex only).
## 14. Implementation order

1. Models + audit actions + error codes (additive, no behavior change)
2. AIGovernancePolicyService engine + decision types (unit-testable in isolation)
3. Budget-state helper + usage-limit windowed aggregation
4. Approval integration (AI_OPERATION resource type + request/decide flow)
5. AIGovernanceGate + AIProviderFactory governed path
6. Policy routes + evaluate + approvals + audit endpoints (+ app.ts mount)
7. Call-site migration to the governed path (highest-value services first)
8. Agent tool policy persistence
9. Frontend console tabs/panels + AI audit dashboard + API client/types
10. Tests (delivered suite + frontend) and full verification

## 15. Verification

- npm run typecheck; npm test (root) - zero regressions, new suites green
- cd frontend && npm run typecheck && npm test
- npm run build (root)
- Manual smoke (optional): model-access policy denies a provider -> governed call denied + audited;
  prompt pattern BLOCK -> eval dry-run returns DENY; premium model requires approval -> approval
  appears in the queue -> approve -> operation succeeds.