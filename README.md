# Workflow Execution Engine

A strict TypeScript workflow platform that validates directed graphs, publishes immutable workflow versions, and executes those versions through durable MongoDB records and BullMQ workers.

The platform is authenticated and multi-tenant: every user gets a personal workspace on registration, and workflows, executions, and audit logs are scoped to a workspace.

The project is built in small, reviewable phases as an advanced backend portfolio project.

## Current Features

### Authentication

- JWT access tokens signed with `AUTH_JWT_SECRET` and a configurable TTL (`AUTH_ACCESS_TTL`, default `15m`)
- Refresh token rotation with per-session families, replay detection, and family-wide revocation
- Session management: list active sessions, revoke a single session, or revoke every session

### Security

- Rate limiting on the login and refresh endpoints
- Audit logging for auth, workspace, workflow, and execution events, with sensitive-key sanitization
- Authorization: workspace, workflow, and execution routes require a valid access token and are scoped to the caller

### Multi-tenancy

- Workspace architecture: the workspace is the tenancy root, and every user gets a personal workspace
- Workspace ownership: an `OWNER` membership is created with the workspace, and workspace routes require membership
- Tenant isolation: `workspaceId` on workflows and executions keeps other tenants unreachable

## Implemented scope

### Phase 1: graph execution engine

- Webhook, condition, and log nodes
- Directed-graph validation and cycle detection
- Deterministic topological execution
- True/false condition branches and `SKIPPED` states
- Execution output and complete node-transition history

### Phase 2A: runtime contracts

- Strict Zod schemas for untrusted workflow JSON
- Type-safe public parsing helpers
- Schema validation before graph validation or execution
- Stable errors for invalid definitions

### Phase 2B: persistence and versioning API

- Express 5 JSON API
- MongoDB persistence through Mongoose
- Editable drafts and explicit validation
- Transactional publishing on a MongoDB replica set
- Immutable sequential workflow versions
- Centralized safe API errors

### Phase 2C: durable execution runtime

- Persisted execution records with status history
- Immutable workflow-version pinning
- Strict execution request validation
- Per-workflow idempotency keys and deterministic BullMQ job IDs
- BullMQ queue adapter with bounded exponential retries
- Separate worker process with configurable concurrency
- Safe terminal failure persistence
- Recovery of records stranded during database-to-queue handoff
- Execution status and workflow execution-history endpoints
- Real Redis/BullMQ and MongoDB integration tests

### Phase 2D: authentication and authorization

- Email/password registration and login with Argon2 password hashing
- JWT access tokens and rotating refresh tokens with family revocation
- Authenticated, owner-scoped workflow and execution routes
- Auth error codes that do not leak whether an account exists

### Phase 2E: production hardening

- Rate limiting on the login and refresh endpoints
- Audit logging with metadata sanitization and no raw secrets
- Refresh token tracking: user agent, IP address, and last use per session family
- Session management endpoints, with family revocation on logout and on replay detection
- Per-execution retry policies (FIXED or EXPONENTIAL) with bounded retry budgets
- Request-level execution timeouts, with EXECUTION_TIMEOUT_MS as the server default
- Dead-letter records for terminal failures and a workflow-scoped listing endpoint
- Manual replay of finished executions as a new linked execution

### Phase 3A: multi-tenancy foundation

- Workspaces as the tenancy root, with OWNER membership and an auto-created personal workspace per user.
- `workspaceId` on workflows, executions, and audit logs; migration-safe tenant scoping keeps legacy `ownerId`-only rows reachable.
- Idempotent `npm run migrate` backfill that creates personal workspaces and stamps legacy data.
- Workspace API: `GET /api/workspaces`, `GET /api/workspaces/:id`, `POST /api/workspaces`, `PATCH /api/workspaces/:id`.
- `defaultWorkspaceId` returned by `/api/auth/register` and `/api/auth/login`.
- RBAC, collaboration, and analytics are deferred to later phases.


## Architecture

```text
src/
  api/
    app.ts
    server.ts
    middleware/
      errorHandler.ts
      rateLimiter.ts
    routes/
      executionRoutes.ts
      workflowRoutes.ts
      workspaceRoutes.ts
  auth/
    auth.controller.ts
    auth.middleware.ts
    auth.routes.ts
    auth.service.ts
    jwt.service.ts
    password.service.ts
  config/env.ts
  db/connection.ts
  engine/
    executeWorkflow.ts
    getReadyNodes.ts
    validateGraph.ts
  migrate.ts
  models/
    AuditLogModel.ts
    DeadLetterModel.ts
    RefreshTokenModel.ts
    UserModel.ts
    WorkflowExecutionModel.ts
    WorkflowModel.ts
    WorkflowVersionModel.ts
    WorkspaceMemberModel.ts
    WorkspaceModel.ts
  queues/
    bullMqExecutionQueue.ts
    executionQueue.ts
  schemas/
    executionSchema.ts
    workflowSchema.ts
  services/
    auditService.ts
    deadLetterService.ts
    executionService.ts
    workflowService.ts
    workspaceService.ts
  types/
    execution.ts
    workflow.ts
  workers/
    executionWorker.ts
    startWorker.ts
```

### Tenancy model

```text
User
 |
Workspace  (tenancy root, OWNER membership)
 |
 +-- Members      WorkspaceMember (role, status)
 +-- Workflows    Workflow.workspaceId
 +-- Executions   WorkflowExecution.workspaceId
 +-- Audit Logs   AuditLog.workspaceId
```

Every account receives a personal workspace at registration, and `POST /api/workflows` can target any workspace the caller belongs to. Routes resolve the caller's workspace and treat rows outside it as missing, so tenants never observe each other's data.

The graph engine remains independent of Express, MongoDB, Redis, and BullMQ. The execution service coordinates persistence and the queue through an injectable interface, allowing contract tests to use a fake queue while integration tests exercise real BullMQ behavior.

## Requirements

- Node.js 20.19 or newer
- npm
- MongoDB configured as a replica set
- Redis

MongoDB transactions are used when publishing workflows. MongoDB Atlas or a local single-node replica set is suitable.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and adjust the values:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/workflow_engine?replicaSet=rs0
REDIS_URL=redis://127.0.0.1:6379
PORT=3000
WORKER_CONCURRENCY=5
EXECUTION_ATTEMPTS=3
EXECUTION_BACKOFF_MS=1000
EXECUTION_TIMEOUT_MS=30000
AUTH_JWT_SECRET=replace-with-a-long-random-secret
AUTH_ACCESS_TTL=15m
AUTH_REFRESH_TTL=30d
```

The API and worker load `.env` automatically when it exists. Existing process environment variables retain their values.

## Commands

```bash
npm run dev          # run the original booking-workflow demo
npm run dev:api      # API with file watching
npm run dev:worker   # worker with file watching
npm run start:api    # API once
npm run start:worker # worker once
npm run migrate      # backfill personal workspaces and stamp legacy tenant data
npm test             # all unit and integration tests
npm run test:watch   # Vitest watch mode
npm run typecheck    # strict TypeScript check
```

Run the API and worker in separate terminals. Both processes require MongoDB and Redis.

## API endpoints

### Authentication

| Method | Path | Purpose | Success |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Create an account and its personal workspace | `201` |
| `POST` | `/api/auth/login` | Exchange credentials for access and refresh tokens | `200` |
| `POST` | `/api/auth/refresh` | Rotate a refresh token | `200` |
| `POST` | `/api/auth/logout` | Revoke the refresh token family | `204` |
| `GET` | `/api/auth/sessions` | List active sessions | `200` |
| `DELETE` | `/api/auth/sessions/:id` | Revoke one session family | `204` |
| `DELETE` | `/api/auth/sessions` | Revoke every session | `204` |

`register` and `login` also return `defaultWorkspaceId`. Protected routes expect `Authorization: Bearer <accessToken>`.

### Workspaces

| Method | Path | Purpose | Success |
| --- | --- | --- | --- |
| `GET` | `/api/workspaces` | List the caller's workspaces with roles | `200` |
| `POST` | `/api/workspaces` | Create a workspace; the caller becomes `OWNER` | `201` |
| `GET` | `/api/workspaces/:id` | Get a workspace the caller belongs to | `200` |
| `PATCH` | `/api/workspaces/:id` | Update name or description (`OWNER` only) | `200` |

### Workflow definitions and versions

| Method | Path | Purpose | Success |
| --- | --- | --- | --- |
| `GET` | `/health` | Health check | `200` |
| `POST` | `/api/workflows` | Create a workflow draft | `201` |
| `GET` | `/api/workflows/:id` | Get a workflow and current draft | `200` |
| `PUT` | `/api/workflows/:id/draft` | Update a draft | `200` |
| `POST` | `/api/workflows/:id/validate` | Validate schema and graph | `200` |
| `POST` | `/api/workflows/:id/publish` | Publish an immutable version | `201` |
| `GET` | `/api/workflows/:id/versions` | List versions oldest first | `200` |
| `GET` | `/api/workflows/:id/versions/:versionId` | Get one version by ID or version number | `200` |
| `POST` | `/api/workflows/:id/versions/:versionId/restore` | Restore an old version as a new published version | `201` |
| `POST` | `/api/workflows/:id/compare` | Compare two versions by ID or number | `200` |

### Executions

| Method | Path | Purpose | Success |
| --- | --- | --- | --- |
| `POST` | `/api/workflows/:id/executions` | Queue the latest published version | `202` |
| `GET` | `/api/executions/:executionId` | Get status, result, error, and history | `200` |
| `GET` | `/api/workflows/:id/executions` | List executions newest first | `200` |
| `POST` | `/api/executions/:executionId/replay` | Replay a finished execution as a new linked execution | `202` |
| `GET` | `/api/workflows/:id/dead-letters` | List dead-lettered executions for a workflow | `200` |

### Queue an execution

```json
{
  "input": {
    "estimatedCost": 15000
  },
  "idempotencyKey": "booking-123",
  "retryPolicy": {
    "type": "EXPONENTIAL",
    "delayMs": 1000,
    "backoffFactor": 2,
    "maxRetries": 2
  },
  "timeoutMs": 30000
}
```

`retryPolicy` and `timeoutMs` are optional. A `FIXED` policy waits `delayMs` before every retry; an `EXPONENTIAL` policy multiplies `delayMs` by `backoffFactor` (default `2`) per attempt, up to one hour. `maxRetries` can only lower the server attempt budget (`EXECUTION_ATTEMPTS`, capped at 20 attempts total). A timed-out attempt follows the same retry policy, and the final attempt fails with `EXECUTION_TIMEOUT`.

The first request creates an execution and queues a deterministic job. Repeating the same key with equivalent JSON input returns the same execution without creating a second job. Reusing the key with different input returns `IDEMPOTENCY_CONFLICT`.

If Redis rejects the enqueue operation, the record becomes `FAILED` with `QUEUE_UNAVAILABLE`; retrying the same request reuses and re-enqueues that execution. API and worker startup also reconcile records stranded in `QUEUING` during an earlier process failure.

## Execution lifecycle

```text
QUEUING -> QUEUED -> RUNNING -> SUCCEEDED
                          \-> FAILED
```

Transient worker failures return the record to `QUEUED` and BullMQ retries with exponential backoff. A terminal failure stores a stable error without exposing the thrown message or stack. Each worker attempt is recorded in `statusHistory`.

The execution stores both `workflowVersionId` and `versionNumber`. Draft edits and later publications cannot change the definition already selected for an execution.

The stored retry policy drives every retry: an attempt that throws returns the execution to `QUEUED` with `retryCount` incremented and `nextRetryAt` set, until `maxRetries` is reached. A terminal failure — retries exhausted or a workflow that reports `FAILED` — is recorded once in the dead-letter collection, and `GET /api/workflows/:id/dead-letters` lists those records newest first. `POST /api/executions/:executionId/replay` copies a finished execution's pinned version and input into a new execution that links back through `parentExecutionId`.

## Error shape

```json
{
  "error": {
    "code": "INVALID_EXECUTION_ID",
    "message": "Invalid execution ID"
  }
}
```

Stable error codes include:

- `INVALID_EXECUTION_ID`
- `EXECUTION_NOT_FOUND`
- `NO_PUBLISHED_VERSION`
- `IDEMPOTENCY_CONFLICT`
- `EXECUTION_NOT_REPLAYABLE`
- `QUEUE_UNAVAILABLE`
- `INVALID_WORKSPACE_ID`
- `WORKSPACE_NOT_FOUND`

Unexpected errors return a generic `INTERNAL_ERROR` response.

## Testing

The test suite covers graph execution, schema contracts, publishing, immutable snapshots, execution request validation, idempotency races, queue handoff failures, retry exhaustion, worker restart recovery, retry policies, execution timeouts, dead-letter records, execution replay, version pinning, status history, real BullMQ job processing, authentication and session management, auth rate limiting, audit logging, authorization isolation, the workspace API, and the tenancy migration. Test services use `MongoMemoryReplSet` and `redis-memory-server`; no permanent test databases are required.

```bash
npm run typecheck
npm test
npm audit --audit-level=high
```

## Current limitations

- No scheduled or cron-triggered workflows
- No React visual workflow builder
- Workspace roles beyond `OWNER` (`ADMIN`, `EDITOR`, `VIEWER`) are stored on memberships but not enforced; collaboration, invitations, and analytics are deferred to later phases
- Workflow and execution routes resolve the caller's workspace from the request body, so a workflow created in a second workspace can only be validated and published (`POST` with `workspaceId` in the body); reads, draft updates, and execution queueing for that workspace are not exposed yet
- No production deployment or distributed tracing; `docker-compose.yml` only provides local MongoDB and Redis for development
- Dead letters are replayed one execution at a time; there is no bulk redrive or automatic dead-letter processing

Those capabilities belong to later phases and are intentionally outside the current phase.
