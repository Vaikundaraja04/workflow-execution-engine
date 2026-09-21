# Phase 12.5 - Autonomous Workflow Optimization Platform (Architecture Plan)

Status: Implemented and verified (backend + frontend typecheck and full test suites pass).
Branch: phase-2e-production-hardening
Depends on: 12.1 AI Copilot, 12.2 Agent Framework, 12.3 Self-Healing, 12.4 Predictive Intelligence.

## 1. Goal

An AI-driven optimization engine that can:
1. analyze workflows against real execution telemetry,
2. detect bottlenecks,
3. generate cost/performance/reliability recommendations as a persisted optimization plan,
4. gate changes through an explicit approval workflow,
5. safely materialize approved changes as DRAFT workflow versions (never auto-publishing),
6. expose everything through RBAC-guarded APIs and an operations dashboard, fully audited.
## 2. Existing assets reused (no rebuilds)

| Asset | Location | Used for |
| --- | --- | --- |
| AI provider layer | src/services/ai/AIProviderFactory.ts, AIProvider.ts | 'optimization' feature provider resolution |
| AI security | src/services/ai/aiSecurityService.ts | prompt/metadata sanitization before AI calls |
| AI usage metering | src/services/aiUsageService.ts | recordUsage(feature='optimization') |
| Predictive intelligence | src/services/predictiveIntelligenceService.ts | failure-risk enrichment of plans |
| Version service | src/services/versionService.ts | hashDefinition, diffVersions, normalizeDefinition |
| Version model | src/models/WorkflowVersionModel.ts | DRAFT version creation (status enum supports DRAFT) |
| Publish flow | src/services/workflowService.ts | untouched; publishing stays a human action |
| Audit | src/services/auditService.ts, src/models/AuditLogModel.ts | lifecycle audit trail |
| RBAC | src/auth/permissions.ts, src/api/middleware/requirePermission.ts | AI_OPTIMIZATION_READ/CREATE/APPROVE |
| Optimization plan model | src/models/WorkflowOptimizationModel.ts | plan persistence (already complete) |
| Optimization routes | src/api/routes/optimizationRoutes.ts | HTTP surface (already written, needs mounting) |
| Frontend pieces | frontend/features/optimization/*, services/optimizationApi.ts, types/optimization.ts | dashboard building blocks |
## 3. Current-state gaps this phase finishes

1. src/services/autonomousOptimizationService.ts is truncated at line 315, mid-class. Missing:
   findRedundantEdges, detectBottlenecks, generateOptimizationPlan, listPlans, getPlanById,
   approvePlan, rejectPlan, applyPlan, and private helpers (change application, impact math, AI explanation).
2. optimizationRoutes is not mounted in src/api/app.ts.
3. Permissions AI_OPTIMIZATION_READ and AI_OPTIMIZATION_APPROVE do not exist (backend or frontend mirrors).
4. No audit actions for the optimization lifecycle.
5. No errorHandler mappings for optimization error codes.
6. No /operations/optimization dashboard page; no nav entry; optimizationApi.applyPlan type misses beforeAfter.
7. No tests.
8. Legacy src/services/autonomousOptimizerService.ts (placeholder) stays untouched: it is still used by
   predictiveOperationsRoutes and tests/predictiveOperations.test.ts. The 12.5 engine is the separate
   autonomousOptimizationService.

## 4. Architecture overview

    Operations Optimization Dashboard (Next.js)
        -> /api/v1/optimization/* (requireAuth + requirePermission + X-Workspace-Id)
            -> AutonomousOptimizationService (singleton)
                -> WorkflowModel / WorkflowExecutionModel   (profile + bottleneck evidence)
                -> WorkflowOptimizationModel               (plan lifecycle)
                -> WorkflowVersionModel + WorkflowModel    (safe DRAFT materialization, transactional)
                -> PredictiveIntelligenceService           (failure-risk enrichment)
                -> AIProviderFactory + AISecurityService + AIUsageService (AI explanation, advisory)
                -> createAuditLog                          (every lifecycle transition)
Service method contracts (workspace-scoped everywhere):

- analyzeWorkflow(workflowId, workspaceId, userId) -> WorkflowAnalysisResult
  30-day window, up to 200 executions; per-node runs/failures/failureRate/timeouts/avgDuration;
  duration percentiles p50/p95/p99 + trend; reliability + cost profile; deterministic bottlenecks;
  predictive risk enrichment; audit AI_OPTIMIZATION_ANALYSIS_COMPLETED.
- generateOptimizationPlan(workflowId, workspaceId, userId) -> IWorkflowOptimization (status PENDING)
  deterministic recommendation engine over bottlenecks; AI explanation (provider 'optimization') is
  advisory text only and failure-tolerant; usage recorded when a provider call happens; audit
  AI_OPTIMIZATION_PLAN_CREATED.
- listPlans(workspaceId, {status, workflowId}) / getPlanById(planId, workspaceId) -> workspace-scoped reads.
- approvePlan / rejectPlan (PENDING-only guards) -> audit APPROVED/REJECTED.
- applyPlan(planId, userId, workspaceId) -> ApplyOptimizationResult
  approval gate, deterministic change application, schema + graph validation, transactional DRAFT version
  creation, plan APPLIED (or FAILED with validationErrors), before/after diff, audit APPLIED/FAILED.

## 5. Recommendation engine (deterministic core; AI is advisory)

Rule sources are the detected bottlenecks. Only provably safe graph edits become actionable changes
(the changes[] list); everything else is advisory with evidence. Actionable changes must pass
WorkflowDefinitionSchema + validateGraph before anything is persisted.

| Rule | Category | Actionable change | Guard |
| --- | --- | --- | --- |
| Redundant transitive edge (u->v while u->..->v exists) | ARCHITECTURE_OPTIMIZATION | REMOVE_EDGE | unconditional edges only (no true/false label) |
| Condition node missing false-branch fallback | RELIABILITY_OPTIMIZATION | ADD_EDGE (condition=false) | target is a log node, not reachable from the true branch, no cycle, no duplicate edge |
| Elevated retries across executions | RELIABILITY_OPTIMIZATION | advisory only | - |
| Repeated timeouts | PERFORMANCE_OPTIMIZATION | advisory only (tuning guidance) | - |
| Slow node (avg > max(500ms, 40% of p95), runs >= 3) | PERFORMANCE_OPTIMIZATION | advisory only (parallelize/cache) | - |
| Agent-node AI spend / premium model detected | COST_OPTIMIZATION | advisory only (model tier / batching) | forces plan approvalRequired |
Per recommendation: id, type, title, description, expectedImprovement {metric, value, unit, description},
confidence (sample size + evidence density), riskLevel (bottleneck severity, escalated HIGH by predictive
risk), requiresApproval, changes[], evidence[].

Plan level: type (dominant category or MIXED), confidence (aggregate), riskLevel (max),
expectedImpact {latencyReductionPercent?, costReductionPercent?, reliabilityGainPercent?, summary},
approvalRequired = any HIGH-risk actionable change OR predictive risk high/critical OR premium model
with actionable changes.

## 6. Approval workflow and state machine

    PENDING --approve--> APPROVED --apply--> APPLIED
    PENDING --reject---> REJECTED
    PENDING/APPROVED --apply(validation failure)--> FAILED (reason recorded; new plan required)
Rules:
- approve/reject only from PENDING (else 409 OPTIMIZATION_PLAN_NOT_PENDING).
- apply requires APPROVED when approvalRequired=true (else 403 OPTIMIZATION_PLAN_APPROVAL_REQUIRED);
  low-risk plans (approvalRequired=false) may apply from PENDING with appliedBy/At recorded.
- REJECTED plans are terminal; FAILED plans are terminal (no retry in this phase).
- Applying an APPLIED plan is 409 OPTIMIZATION_PLAN_ALREADY_APPLIED.

## 7. Safe workflow version creation

applyPlan performs, in one mongoose transaction:
1. Load plan (workspace-scoped) and workflow (workspace-scoped).
2. Deep-clone workflow.draftDefinition; apply the union of changes from non-advisory recommendations
   deterministically (UPDATE_NODE_CONFIG merges config, ADD/REMOVE_EDGE, ADD_NODE). If nothing to apply:
   422 OPTIMIZATION_NO_APPLICABLE_CHANGES.
3. Validate candidate: WorkflowDefinitionSchema.safeParse + validateGraph. On failure: plan -> FAILED +
   failureReason, audit FAILED, return {applied: false, validationErrors} (route answers 422); nothing
   else is persisted.
4. On success (all in transaction): create WorkflowVersion {status: DRAFT, versionNumber:
   latestVersionNumber+1, sourceVersionId: publishedVersionId, definitionHash, changeSummary referencing
   the plan}; set workflow.draftDefinition = candidate, workflow.status = 'DRAFT',
   workflow.latestVersionNumber += 1 (allocation so a later human publish gets the next number);
   plan -> APPLIED with appliedVersionId/Number + beforeAfter (diffVersions between the pre-apply draft
   baseline and the created DRAFT version).
5. The published version is never touched. Publishing remains the existing human-driven flow.
## 8. API surface (mount /api/v1/optimization)

| Method | Path | Permission |
| --- | --- | --- |
| GET | /workflows/:id/analyze | AI_OPTIMIZATION_READ |
| POST | /workflows/:id/generate-plan | AI_OPTIMIZATION_CREATE |
| GET | /plans | AI_OPTIMIZATION_READ |
| GET | /plans/:id | AI_OPTIMIZATION_READ |
| POST | /plans/:id/approve | AI_OPTIMIZATION_APPROVE |
| POST | /plans/:id/reject | AI_OPTIMIZATION_APPROVE |
| POST | /plans/:id/apply | AI_OPTIMIZATION_CREATE |

apply responds 422 with {code: OPTIMIZATION_VALIDATION_FAILED, details} when candidate validation fails.

## 9. RBAC and workspace isolation

New permissions (backend src/auth/permissions.ts + frontend mirror frontend/types/permissions.ts):
- AI_OPTIMIZATION_READ, AI_OPTIMIZATION_APPROVE (joining existing AI_OPTIMIZATION_CREATE).

Matrix: OWNER/ADMIN = all AI permissions; EDITOR = READ + CREATE (no APPROVE); VIEWER = READ only.

Isolation: every model query is scoped by workspaceId; plans resolve by (_id, workspaceId); workflows by
(_id, workspaceId); analysis reads are workspace-scoped; route middleware resolves the workspace from the
workflow param or X-Workspace-Id header (existing requirePermission behavior).
## 10. Audit actions (AuditLogModel additions)

AI_OPTIMIZATION_ANALYSIS_COMPLETED, AI_OPTIMIZATION_PLAN_CREATED, AI_OPTIMIZATION_PLAN_APPROVED,
AI_OPTIMIZATION_PLAN_REJECTED, AI_OPTIMIZATION_PLAN_APPLIED, AI_OPTIMIZATION_PLAN_FAILED.
Metadata never contains secrets (AISecurityService.sanitizeMetadata / filterSensitiveData).

## 11. Error codes (errorHandler mappings)

INVALID_OPTIMIZATION_ID 400, INVALID_OPTIMIZATION_STATUS 400, OPTIMIZATION_PLAN_NOT_FOUND 404,
OPTIMIZATION_PLAN_NOT_PENDING 409, OPTIMIZATION_PLAN_ALREADY_APPLIED 409,
OPTIMIZATION_PLAN_NOT_APPLICABLE 409, OPTIMIZATION_PLAN_APPROVAL_REQUIRED 403,
OPTIMIZATION_NO_APPLICABLE_CHANGES 422.

## 12. Files

Backend:
- M src/services/autonomousOptimizationService.ts (complete the truncated class)
- M src/auth/permissions.ts
- M src/models/AuditLogModel.ts
- M src/api/middleware/errorHandler.ts
- M src/api/app.ts (mount)
- M src/api/routes/optimizationRoutes.ts (only small wiring fixes if needed)

Frontend:
- A frontend/features/optimization/OptimizationDashboard.tsx
- A frontend/app/operations/optimization/page.tsx
- M frontend/app/operations/page.tsx (nav link)
- M frontend/services/optimizationApi.ts (applyPlan result gains beforeAfter)
- M frontend/types/permissions.ts (permission mirror)

Tests:
- A tests/autonomousOptimization.test.ts (service + lifecycle + isolation + audit)
- A frontend/tests/optimizationServices.test.ts (api serialization, envelopes, headers)
## 13. Test plan (backend)

MongoMemoryReplSet, mirroring tests/predictiveIntelligence.test.ts conventions:
1. Performance profiling: durations/percentiles/trend, node stats, reliability, cost, window.
2. Bottleneck detection: slow node, failing node, redundant edge, missing false-branch, timeout/retry signals.
3. Plan generation: PENDING plan persisted with recommendations, changes, confidence, expectedImpact;
   approvalRequired escalation; advisory-only plans remain valid plans.
4. Approval workflow: approve/reject happy path + guards (non-PENDING 409), audit entries created.
5. Apply: approval gate, DRAFT version created with next number, workflow draft updated + status DRAFT +
   latestVersionNumber allocated, beforeAfter diff populated, plan APPLIED, published version untouched.
6. Validation failure: tampered/bogus change -> plan FAILED, validationErrors returned, no version created.
7. Workspace isolation: plans/analysis hidden across workspaces; cross-workspace approve/apply rejected.
8. Audit logging: one entry per lifecycle transition with expected action codes.

Frontend test: request shapes/headers/envelopes for analyze/generate/list/approve/reject/apply.

## 14. Non-goals (this phase)

- No auto-publish and no self-applying automation; humans gate approvals.
- AI-generated recommendations are never auto-applied; only validated deterministic rules produce changes.
- Legacy autonomousOptimizerService (predictive-operations dependency) is untouched.
- No changes to the provider layer, NodeCapabilityRegistry, Copilot, self-healing or predictive modules.

## 15. Verification

- npm run typecheck (root, includes tests)
- npm test (root vitest, all suites; expect zero regressions)
- cd frontend && npm run typecheck && npm test
- Manual smoke (optional): dashboard -> analyze -> generate plan -> approve -> apply -> DRAFT version visible.