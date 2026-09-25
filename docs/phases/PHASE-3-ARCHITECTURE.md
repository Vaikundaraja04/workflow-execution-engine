# Phase 3: multi-user SaaS workflow automation platform

Phase 3 transforms the single-owner workflow engine into a multi-tenant SaaS automation platform. It adds workspaces with role-based access control, workflow collaboration, advanced versioning, a scaled execution platform, analytics, new APIs, plus the database and migration design that support them. The graph engine, execution lifecycle, and worker contract are preserved and extended, not rewritten.

Status: implemented and verified. (This architecture plan is retained for historical context; the Phase 3 surface shipped as described below.)

## 1. Phase 3 Vision

### Current platform capabilities

- Strict TypeScript workflow engine with deterministic topological execution (Phase 1).
- Strict Zod schemas for untrusted workflow definitions (Phase 2A).
- Durable workflow versions published transactionally on a MongoDB replica set (Phase 2B).
- Durable executions with status history, idempotency keys, and version pinning (Phase 2C).
- BullMQ queue adapter and a separate worker with bounded exponential retries and crash recovery (Phase 2C).
- Email/password accounts, JWT access tokens, rotating refresh tokens with replay detection, session management (Phase 2D / 2E).
- Per-user ownership isolation on workflows and executions (Phase 2D).
- Authentication rate limiting and structured audit logging (Phase 2E).
- Docker Compose dev environment with MongoDB 7 (replica set rs0) and Redis 7.

### Limitations of the current architecture

- Ownership is a single ownerId; there is no team, workspace, or organization concept.
- Every workflow is private to exactly one user and cannot be shared or delegated.
- No roles or permission structure; the owner bit is the only authorization axis.
- Versioning is binary (DRAFT / latest PUBLISHED); there is no history, comparison, rollback, or restore.
- Executions are FIFO with one global retry policy and no priority, timeout, dead-letter queue, or replay.
- No analytics; success/failure, duration, node performance, and activity are not queryable.
- The API surface is flat (workflows and executions only).
- Audit logs are user-scoped, not tenant-scoped; no retention or aggregation.
- No machine-to-machine API keys for automation and SaaS integration.
### Phase 3 goals

- Introduce workspace-based multi-tenancy on top of the existing single-owner data.
- Introduce OWNER / ADMIN / EDITOR / VIEWER roles with fine-grained permissions.
- Enable workflow collaboration through team membership and controlled ownership transfer.
- Add full versioning: history, rollback, restore, and definition comparison.
- Scale the execution platform with priority lanes, timeouts, a dead-letter queue, and replay.
- Add an analytics surface for workflows, executions, and user/workspace activity.
- Extend the API with workspace, membership, permission, and analytics resources.
- Adapt every existing endpoint to be tenant-scoped and permission-aware while preserving the error shape and codes for unchanged behavior.
- Provide a zero-data-loss migration from single-owner to workspace tenancy.

### Expected future scale

- Many tenants sharing one logical MongoDB database with workspaceId on every tenant-owned row (logical tenancy).
- Enough executions per day that aggregation must be indexed and pre-aggregated.
- A single BullMQ worker pool serving many tenants with fairness, priority, and dead-letter recovery.
- Per-workspace isolation without database-per-tenant, to contain operational cost at this scale.

## 2. Multi-Tenant Architecture

### Workspace model

A Workspace is the tenancy root. Every tenant-owned domain object (workflows, executions, audit logs, analytics, members) references it.

```text
User
 |
Workspace
 |
 +-- Members            (WorkspaceMember, one per user per workspace)
 +-- Roles              (OWNER | ADMIN | EDITOR | VIEWER)
 +-- Workflows          (Workflow.workspaceId)
 +-- Executions         (WorkflowExecution.workspaceId)
 +-- Audit Logs         (AuditLog.workspaceId)
```

### Workspace model definition

New collection `workspaces` (`WorkspaceModel`):

| Field | Type | Notes |
| --- | --- | --- |
| name | string | required, trimmed, 1..120 |
| slug | string | required, unique, lowercase, url-friendly, 1..64 |
| description | string | optional, max 280 |
| ownerId | ObjectId ref User | required, founding/transfer target member |
| status | enum ACTIVE/SUSPENDED/DELETED | SUSPENDED blocks all member access |
| settings | Mixed | feature flags, retention, workspace options |
| createdAt, updatedAt | Date | timestamps |

Index: `{ slug: 1 }` unique. Query patterns: `{ slug: 1 }`, `{ ownerId: 1 }`.
### Membership model definition

New collection `workspace_members` (`WorkspaceMemberModel`):

| Field | Type | Notes |
| --- | --- | --- |
| workspaceId | ObjectId ref Workspace | required |
| userId | ObjectId ref User | required |
| role | enum OWNER/ADMIN/EDITOR/VIEWER | required |
| status | enum ACTIVE/INVITED/REMOVED | INVITED until accepted |
| invitedBy | ObjectId ref User | optional |
| lastActiveAt | Date | refreshed on API request |
| createdAt, updatedAt | Date | timestamps |

Indexes: `{ workspaceId: 1, userId: 1 }` unique; `{ userId: 1, role: 1 }` for "my workspaces".

### Ownership rules

- A Workspace always has exactly one ACTIVE membership with role OWNER.
- The owner has the ADMIN permission surface plus owner-only actions: transfer ownership, suspend/delete the workspace, rename slug.
- A Workflow is owned by a workspace. The legacy `ownerId` field becomes `createdBy` (audit-oriented creator). Ownership is resolved by `workspaceId`, never by `ownerId`.
- Executions copy `workspaceId` at creation; the tenant scope never changes at runtime.
- Only an ADMIN or the OWNER may add members; only the OWNER may remove or downgrade a member with role OWNER.

### Tenant isolation strategy

- One shared MongoDB database with `workspaceId` stamped on every tenant-owned document.
- Every service query filters by `workspaceId` plus resolved permissions, enforced in the service layer, not only in middleware.
- Idempotency keys and job IDs are scoped per workspace (`workspaceId : workflowId : key`) so tenants may reuse identical keys.
- The trusted worker and recovery process run unscoped (as in Phase 2D decision 7) but every write carries the `workspaceId` captured at creation.
- A single named BullMQ queue schedules executions for all tenants; per-workspace priority classes are added in Phase 3D.
## 3. Role-Based Access Control (RBAC)

### Roles

Four closed roles. `role` on a member is the single permission source of truth.

| Role | Intended for | Access |
| --- | --- | --- |
| OWNER | founding / billing owner | all permissions + owner-only actions (transfer, suspend) |
| ADMIN | trusted operator | all permission bits |
| EDITOR | collaborator | read, create, update, execute workflows |
| VIEWER | read-only | read workflows, executions, analytics |

### Permissions

| Permission | Effect |
| --- | --- |
| WORKFLOW_CREATE | create a workflow draft |
| WORKFLOW_READ | read a workflow, its versions, its execution list |
| WORKFLOW_UPDATE | update draft, validate, publish |
| WORKFLOW_DELETE | delete a workflow |
| WORKFLOW_EXECUTE | start an execution |
| MEMBER_MANAGE | add / update / remove members and roles |
| AUDIT_READ | read audit logs and analytics |

### Role -> permission matrix

| | CREATE | READ | UPDATE | DELETE | EXECUTE | MEMBER | AUDIT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OWNER | X | X | X | X | X | X | X |
| ADMIN | X | X | X | X | X | X | X |
| EDITOR | X | X | X | X | X | | |
| VIEWER | | X | | | | | |

Abbreviated columns (WORKFLOW_/MANAGE_ prefixes omitted). Owner-only actions outside the matrix: `workspace.transfer`, `workspace.suspend`, `workspace.delete`, `member.remove(OWNER)`.

### Permission checking

1. `requireAuth` validates the access token and sets `req.user` (existing).
2. A new `requirePermission(workspaceIdSource, permission)` middleware resolves the tenant (url param, body `workspaceId`, or the caller's default workspace for legacy routes).
3. It loads the ACTIVE membership for `(workspaceId, userId)`.
4. It maps `role` to a permission set from a constant table.
5. On absent permission it calls `next(err)` with a determinate code.
6. Membership lookups are cached in memory for a short TTL (30-60s) and cache-busted on membership change.
### Middleware design

Mirrors `createRequireAuth(config)` so routes stay declarative:

```ts
import type { RequestHandler } from 'express';

export interface PermissionResolver {
  resolve(req: Request, permission: Permission): Promise<'allow' | 'deny' | 'absent'>;
}

export function buildRequirePermission(resolver: PermissionResolver): {
  require(permission: Permission): RequestHandler;
};
```

Usage on a route:

```ts
router.get('/workflows/:id', requirePermission('WORKFLOW_READ'), handler);
```

### Missing membership vs missing permission

- Membership absent -> `403 PERMISSION_DENIED` (tenant does not exist for this caller).
- Membership present, role lacks the bit -> `403 FORBIDDEN`.
- Resource scoped elsewhere -> `404 NOT_FOUND`, reusing Phase 2D's rule so cross-tenant access never reveals existence.
- Read-before-write on `/:id` routes stays workspace-scoped so a missing id returns 404 before role logic runs.

### Database structure for permission

New collections:

| Collection | Purpose |
| --- | --- |
| workspaces | tenancy root (ownerId, slug) |
| workspace_members | `(workspaceId, userId)` unique; role + status |
| workspace_roles | optional Phase 3B store of role -> permission map for observability or future custom roles; Phase 3A keeps it as a code constant |

If `workspace_roles` is stored it is a document `{ name, permissions: [...] }`; OWNER/ADMIN/EDITOR/VIEWER are seeded idempotently, and the resolver still prefers the constant table so the stored entries cannot diverge.
## 4. Workflow Collaboration

### Features

- Share workflows: a workflow is shareable within its workspace; permission follows membership.
- Team access: VIEWER/EDITOR read or collaborate; ADMIN/OWNER manage it.
- Permissions inheritance: workflow permission is inherited from the membership role through `workspaceId`; no per-workflow ACL is required for the common case.
- Ownership transfer: `POST /api/workspaces/:id/transfer` (OWNER only) moves `ownerId` and re-role the previous owner to ADMIN if they stay. `createdBy` on workflows is immutable audit metadata and never changes on transfer.

### Required model changes

- `WorkflowModel` gains `workspaceId` (required) and `createdBy` (the migration carries the old `ownerId` value). Permission is resolved from the workspace, not the creator.
- Optional `WorkflowAccess` collection for future cross-workspace grants, left as an extension point and not built in Phase 3A:

| Field | Type | Notes |
| --- | --- | --- |
| workflowId | ObjectId ref Workflow | required |
| workspaceId | ObjectId ref Workspace | owning tenant |
| grantWorkspaceId | ObjectId ref Workspace | receiving tenant |
| grantRole | enum READ/EXECUTE | scope |
| createdBy | ObjectId ref User | audit trail |

- `AuditLogModel` gains `workspaceId` so every collaboration change is tenant-scoped.

## 5. Advanced Workflow Versioning

### Current model

`WorkflowVersion` today: `workflowId`, `versionNumber` (>=1), `definition`, `createdAt`; the workflow holds `draftDefinition`, `latestVersionNumber`, `publishedVersionId`. There is no history navigation or rollback beyond editing the draft.

### Future model

New fields on `WorkflowVersion`:

| Field | Type | Notes |
| --- | --- | --- |
| createdBy | ObjectId ref User | who created the version |
| sourceVersionNumber | number | set on restore/rollback for auditability |
| definitionHash | string sha256 | canonical hash; powers compare and dedupe |
| changeType | enum VERSION/PATCH/RESTORE/ROLLBACK | how the page was produced |
| note | string optional | author note |

Semantics: versions are immutable; restore/rollback create a NEW version referencing a `sourceVersionId`; compare normalizes the definition (stable-sorted nodes, edges, operator/value) before diff; publishing the same `definitionHash` again dedupes to the existing latest version.
### Version endpoints

Mutation requires WORKFLOW_UPDATE; lists/compare require WORKFLOW_READ.

| Method | Path | Purpose | Success |
| --- | --- | --- | --- |
| GET | /api/workflows/:id/versions | list history (existing, richer) | 200 |
| GET | /api/workflows/:id/versions/:versionNumber | fetch an immutable snapshot | 200 |
| POST | /api/workflows/:id/versions/:versionNumber/restore | republish a new version from that snapshot | 201 |
| GET | /api/workflows/:id/versions/compare?from=A&to=B | structural + fields diff of two definitions | 200 |
| POST | /api/workflows/:id/versions/:versionNumber/rollback | alias of restore, idempotent | 201 |

### Why this shape

Preserves the immutable-version guarantee and the execution `workflowVersionId` pin; rollback is a new history node, never a destructive overwrite; `definitionHash` also drives change detection for analytics and audit.

## 6. Execution Platform Scaling

### Goals

Parallel execution across workers and per tenant; priority lanes; a per-workflow retry strategy; timeout handling; a dead-letter queue; and execution replay.

### BullMQ changes

| Concern | Phase 2C today | Phase 3D target |
| --- | --- | --- |
| Queue | single `workflow-executions` | base queue + optional per-workspace subscriber queues |
| Priority | none (FIFO) | `priority` on job opts (smaller = higher); API `priority: 1..100`, default 50 |
| Retries | attempts/exponential backoff at enqueue | per-workflow `retryPolicy` resolved at enqueue |
| Timeout | not enforced | engine per-node `timeoutMs` + job-level timeout via `job.timeout` |
| Dead letters | failed jobs stay enqueued | `failed` event -> copy job to `workflow-executions-dead`; execution marked FAILED with code DEAD_LETTERED |
| Replay | none | POST /api/executions/:id/replay re-queues a new execution with `replayOf` |

### Concurrency and isolation

- Worker `concurrency` stays config-driven (`WORKER_CONCURRENCY`).
- Jobs carry `workspaceId`; the worker and engine never cross a tenant boundary because it is stamped once at creation.
- Per-workspace enqueue order keeps one heavy tenant from starving others; a semaphore can be added later if metrics prove contention.
- The existing `recoverPendingExecutions` recovery loop stays tenant-agnostic.
### Retry strategy

- Optional per-workflow policy published with each version: `{ "retryPolicy": { "maxAttempts": 3, "backoffMs": 1000, "backoffFactor": 2 } }`.
- An execution-level override is allowed on `/executions`. Retries are recorded in `attemptsMade` and status history.
- Failure classes: transient (stalled, infrastructure) -> backoff; terminal (invalid definition, engine error) -> immediate FAILED; unknown -> default budget. Attempts never exceed the `EXECUTION_ATTEMPTS` cap.
- Policies are immutable once a version is published.

### Timeout handling

- Per node: `timeoutMs` in node config; the engine aborts that node as FAILED while the rest follows policy.
- Job level: BullMQ `job.timeout` plus a worker-side deadline so a stuck handler never hangs the worker; a timeout is failed and retried per policy.
- `startedAt` / `finishedAt` on the execution drive `durationMs` for analytics.

### Dead-letter queue

- A queue `workflow-executions-dead` receives jobs that exhausted retries or timed out; the execution becomes FAILED with `error.code = 'DEAD_LETTERED'`.
- A DLQ consumer (part of the worker CLI, opt-in via `ENABLE_DLQ=1`) records items; it does not auto-respawn failed production runs.
- Operations replay DLQ items with a resolvable retry policy or fix the cause.

### Execution replay

- `POST /api/executions/:id/replay` requires WORKFLOW_EXECUTE. It clones `input` and the pinned `workflowVersionId`, issues fresh execution and job ids, sets `replayOf` to the original, writes an EXECUTION_REPLAYED audit entry, and always re-runs the exact snapshot that originally ran.
## 7. Analytics Platform

### Workflow analytics

Aggregated from WorkflowExecution per workflow: executionsCount, successRate, failureRate, avgDurationMs (`GET /api/analytics/workflows/:workflowId`).

### Execution analytics

From a single execution: duration (`finishedAt - startedAt`), retries (`attemptsMade`), node performance (per-node time summed from `result.executionHistory` timestamps) (`GET /api/analytics/executions/:executionId`).

### User / workspace analytics

Activity (member actions in a window) and API usage (requests / executions per day) derived from AuditLog and WorkflowExecution (`GET /api/analytics/usage`, `GET /api/analytics/usage/:userId`).

### Storage design

On-the-fly aggregation over indexed WorkflowExecution / AuditLog for recent windows, plus a pre-aggregated rollup `ExecutionDailyRollup` (`{ workspaceId, workflowId?, day, count, succeeded, failed, attempts, avgDurationMs }`) recomputed by a nightly job in the worker. Analytics reads require WORKFLOW_READ; usage and audit reads require AUDIT_READ.

## 8. API Evolution

### New endpoints

Workspaces:

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| POST | /api/workspaces | create workspace (caller becomes OWNER) | any authenticated |
| GET | /api/workspaces | list my workspaces | any authenticated |
| GET | /api/workspaces/:id | get workspace + member summary | MEMBER |
| PATCH | /api/workspaces/:id | rename / settings | OWNER |
| DELETE | /api/workspaces/:id | soft-delete then purge | OWNER |

Members:

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| POST | /api/workspaces/:id/members | invite / add by email or userId | MEMBER_MANAGE |
| GET | /api/workspaces/:id/members | list with roles | MEMBER_MANAGE |
| PATCH | /api/workspaces/:id/members/:userId | change role | MEMBER_MANAGE; OWNER guards OWNER targets |
| DELETE | /api/workspaces/:id/members/:userId | remove | MEMBER_MANAGE |
Roles and Permissions:

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | /api/permissions | return the role->permission matrix | public (authenticated) |
| GET | /api/workspaces/:id/roles | roles available for the workspace | MEMBER |

Analytics:

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | /api/analytics/workflows | workspace workflow stats | WORKFLOW_READ |
| GET | /api/analytics/workflows/:workflowId | per-workflow stats | WORKFLOW_READ |
| GET | /api/analytics/executions/:executionId | execution metrics | WORKFLOW_READ |
| GET | /api/analytics/usage | tenant activity / API usage | AUDIT_READ |

### Compatibility with existing endpoints

- `POST /api/workflows` accepts an optional `workspaceId`; when absent it uses the caller's default workspace.
- Every existing workflow and execution route resolves the tenant the same way and applies the permission middleware. Error shape and codes are preserved except the new 403 codes from Phase 3B.
- `/api/auth/*` stays unchanged; the login/session payload additionally returns `defaultWorkspaceId`.

## 9. Database Changes

### New collections

| Collection | Purpose | Key indexes |
| --- | --- | --- |
| workspaces | tenancy root | `{ slug: 1 }` unique |
| workspace_members | membership and role | `{ workspaceId, userId }` unique; `{ userId, role }` |
| workspace_roles (optional) | role->permission seed / custom roles | `{ name: 1 }` unique |
| api_keys | machine-to-machine keys (scaffolded) | `{ keyHash: 1 }` unique; `{ workspaceId, name }` |
| execution_daily_rollup | analytics rollup | `{ day, workspaceId }`, `{ day, workflowId }` |

### Modified collections

| Collection | Additions | Indexes to add |
| --- | --- | --- |
| users | defaultWorkspaceId, active | `{ defaultWorkspaceId: 1 }` |
| workflows | workspaceId (required), createdBy | `{ workspaceId, createdAt: -1 }` |
| workflow_executions | workspaceId, priority, deadLettered, replayOf, durationMs | `{ workspaceId, createdAt: -1 }`; `{ workspaceId, status }` |
| workflow_versions | createdBy, sourceVersionId, definitionHash, changeType | `{ workflowId, definitionHash }` |
| audit_logs | workspaceId | `{ workspaceId, createdAt: -1 }`; `{ workspaceId, action }` |
| refresh_tokens | none | none |
### Index notes

- Every read path filters on `workspaceId` first to avoid cross-tenant scans.
- Execution identity becomes `{ workspaceId, workflowId, idempotencyKey }` unique; `jobId` stays globally unique (BullMQ contract).
- Retention via per-workspace TTL and daily rollups keeps audit and analytics bounded; indexes build idempotently in the migration script before the worker opens queues.
## 10. Security Considerations

- **Tenant isolation**: logical tenancy; `workspaceId` is a required filter on every tenant-scoped query in the service layer, not just in middleware.
- **Authorization checks**: permission middleware runs after `requireAuth`; read-then-write; a missing resource yields 404 (not 403) so existence is never revealed.
- **Data leakage prevention**: strict zod schemas reject `workspaceId` spoofing; the tenant is resolved from the authenticated context and never trusted from the body for ACTIVE workspaces; secret fields are never returned in responses.
- **Audit requirements**: every tenant-scoped mutation writes an AuditLog with workspaceId, actor, resource, resourceId, and metadata; AUDIT_READ is required to view audit data.
- **API security**: the existing login rate limits extend to per-route permission outcomes; TLS is terminated in front of the API; future API keys reuse the bearer + permission path and are stored hashed (only the hash in the DB).
## 11. Migration Strategy

### Backward compatibility objective

Phase 2 data (users, workflows with ownerId, executions, audit logs) keeps working while tenant maps are added. The flat /api/workflows* routes remain reachable by resolving the caller's default workspace when no workspaceId is supplied.

### Steps

1. Idempotent schema migration script (npm run migrate): add workspaceId (nullable) to workflows, executions, versions, audit logs; add defaultWorkspaceId (nullable) to users; add createdBy to workflows copied from ownerId.
2. For each user with no workspace, create a lazily-created personal workspace (slug personal-<userId>), insert an OWNER membership, and set user.defaultWorkspaceId; idempotent and safe to run on demand or after boot.
3. Backfill: set workflow.workspaceId from the user default; copy it to executions and recompute for audit logs; version.createdBy from workflow.ownerId (kept).
4. Compatibility flag WORKSPACE_DEFAULT_MODE=personal keeps existing clients working; switch to workspace-first after adoption.
5. Rollback safety: the script is additive and transaction-scoped per tenant, so a partial failure rolls back with zero data loss.

### Zero data loss

- No deletes; the migration is additive only. ownerId is kept until the workspace path has fully taken over.
- Idempotency uniqueness becomes per-workspace after backfill; a global re-key preserves old runs.
- Validated against a fixture replicating the Phase 2 shape before touching real data.
## 12. Implementation Roadmap

Each sub-phase builds, then validates with its suites plus `npm run typecheck`.

### Phase 3A - Multi-tenancy foundation

- Files affected: src/models/WorkspaceModel.ts, src/models/WorkspaceMemberModel.ts, src/services/workspaceService.ts, src/api/routes/workspaceRoutes.ts, src/config/env.ts, src/api/app.ts, src/api/server.ts, .env.example, README.md.
- Models affected: Workspace, WorkspaceMember, User (defaultWorkspaceId), Workflow (workspaceId, createdBy), WorkflowExecution (workspaceId), AuditLog (workspaceId).
- Tests required: tests/workspaceApi.test.ts (create/list/get/update/isolation), tests/workspaceMigration.test.ts (personal workspace creation, additivity, rollback), update tests/workflowApi.test.ts.

### Phase 3B - RBAC

- Files affected: src/auth/permissions.ts, src/api/middleware/requirePermission.ts, src/auth/auth.middleware.ts, workflowRoutes.ts, executionRoutes.ts, errorHandler.ts (PERMISSION_DENIED / FORBIDDEN), src/api/app.ts.
- Models affected: WorkspaceMember (role), optional WorkspaceRole seed.
- Tests required: tests/rbac.test.ts (matrix fixtures), tests/rbacIsolation.test.ts (403/404, invite acceptance, role change, OWNER guard) — rbacIsolation was not split out; the 403/404 and role-guard coverage is consolidated in tests/rbacAuthorization.test.ts and tests/rbacSecurity.test.ts.

### Phase 3C - Collaboration

- Files affected: src/api/routes/memberRoutes.ts, src/services/memberService.ts, workspaceRoutes.ts (transfer), src/types/collaboration.ts.
- Models affected: Workflow (workspaceId only; optional WorkflowAccess extension), AuditLog (existing).
- Tests required: tests/members.test.ts, tests/collaboration.test.ts (share/inherit, transfer invariants), tests/authzTransfer.test.ts (not split out; transfer coverage lives in tests/collaboration.test.ts / tests/members.test.ts).
### Phase 3D - Advanced execution

- Files affected: src/services/executionService.ts, src/queues/bullMqExecutionQueue.ts, src/workers/executionWorker.ts, src/workers/dlq.ts (new), src/engine/executeWorkflow.ts (timeout), src/schemas/executionSchema.ts (priority, retryPolicy, replay), src/types/execution.ts.
- Models affected: WorkflowExecution (priority, deadLettered, replayOf, durationMs), WorkflowVersion (retry/timeout defaults).
- Tests required: tests/executionPriority.test.ts, tests/executionTimeout.test.ts, tests/deadLetter.test.ts, tests/executionReplay.test.ts; update tests/executionRuntime.test.ts.

### Phase 3E - Analytics

- Files affected: src/api/routes/analyticsRoutes.ts, src/services/analyticsService.ts, src/workers/analyticsRollup.ts, src/schemas/analyticsSchema.ts, src/types/analytics.ts.
- Models affected: WorkflowExecution (already added), AuditLog (already added), ExecutionDailyRollup (new).
- Tests: tests/analytics.test.ts (workflow/execution metrics; rollup/TTL and tenant-isolation coverage consolidated here — the separately planned analyticsUsage/analyticsIsolation files were not split out).
## 13. Risks and Decisions

### Technical risks

- Logical tenancy at scale: large tenants grow workspaceId-led indexes; mitigate with capped, TTL'd audit and analytics rollups and revisit database-per-tenant only if heavy isolation becomes a real need.
- BullMQ priority across many tenants can starve batch work; mitigate with a small set of priority classes and per-workspace subscriber queues if metrics prove contention.
- Definition comparison is subtle (node id order, string vs number values); mitigate with a canonical definitionHash and a matcher fixture suite.
- Analytics throughput: on-the-fly aggregation cannot be the only path; use daily rollups with bounded queries.
- Migration audibility: keep the migration additive and transaction-scoped per tenant so any partial failure rolls back.

### Scalability concerns

- One shared queue and worker pool bounds throughput; per-workspace queue consumers are the primary scaling lever.
- Audit and analytics growth must be capped by retention and a scheduled rollup, otherwise their indexes grow without bound.

### Open decisions

- Logical tenancy (chosen) vs database-per-tenant vs collection-per-tenant.
- Whether workspace_roles becomes a stored collection or stays a code constant (Phase 3A: constant, stored later).
- Whether cross-workspace WorkflowAccess grants land in Phase 3C or are deferred to Phase 4.
- Whether to keep the legacy ownerId field indefinitely (default: keep, marked deprecated) or remove it after migration settles.
- Machine-to-machine API keys are scaffolded in the data model and built in a later phase.
- Default retention periods (e.g., 180 days audit, 90 days analytics rollup) need a decision in Phase 3E.

## Out of scope (deferred)

OAuth/SSO (SAML), webhook subscriptions beyond node trigger config, machine-to-machine API keys (data model only), scheduled/cron workflows, frontend and visual builder and dashboards, multi-region or horizontal sharding.
## Acceptance criteria

- npm run typecheck passes; npm test passes including the new workspace, RBAC, collaboration, execution, and analytics suites.
- A user in workspace W2 can never read or reach a workflow, audit, or analytics entry of W1 through the API or worker.
- Role changes take effect within the documented cache TTL.
- Version restore/rollback always creates a new immutable version; no history entry is mutated.
- The migration script is idempotent, additive, and leaves workspaceId and ownerId consistent on a Phase 2-shaped fixture.
- README documents the new endpoints, roles and matrix, env vars, and migration procedure.

## Open questions for review

1. Default personal-workspace name and the exact migration trigger (eager at first login vs lazy on first write).
2. Keep ownerId on Workflow forever, or remove it after migration settles.
3. Should WORKFLOW_DELETE be granted to EDITOR, or only to ADMIN/OWNER (current plan: ADMIN/OWNER only).
4. Cross-workspace sharing: build WorkflowAccess in Phase 3C, or leave it as a documented extension point.

## Implementation order (sequential)

1. Phase 3A: workspaces + membership + migration + isolation endpoints.
2. Phase 3B: RBAC matrix + permission middleware + 403/404 split + tests.
3. Phase 3C: member API + collaboration + ownership transfer.
4. Phase 3D: priority / retry / timeout / DLQ / replay executor changes.
5. Phase 3E: analytics routes + rollup job + isolation tests.
6. README, .env.example, and the Phase 3 acceptance validation.