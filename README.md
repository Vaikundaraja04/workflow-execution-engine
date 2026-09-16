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
- `helmet` security headers, a `CORS_ORIGINS` allowlist, and a global `/api` rate limit (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`)

### Multi-tenancy

- Workspace architecture: the workspace is the tenancy root, and every user gets a personal workspace
- Workspace ownership: an `OWNER` membership is created with the workspace, and workspace routes require membership
- Tenant isolation: `workspaceId` on workflows and executions keeps other tenants unreachable

### Observability

- Structured JSON logs with a request id (`x-request-id`) echoed on every response and repeated in error bodies
- Health endpoints: `/health` aggregates MongoDB, Redis, and worker-heartbeat checks, while `/health/ready` and `/health/live` back readiness and liveness probes
- Workers publish a Redis heartbeat with a TTL, so a missing worker surfaces as `degraded` instead of a hard failure

### API documentation

- OpenAPI 3.0 document at `/api/openapi.json` and Swagger UI at `/api/docs`

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
- Security headers (`helmet`), CORS origins from `CORS_ORIGINS`, and a global `/api` rate limit (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`)
- Structured request logs with `x-request-id` correlation ids, status, duration, and sensitive-field redaction
- Health endpoints (`/health`, `/health/ready`, `/health/live`) backed by MongoDB, Redis, and a worker heartbeat key
- OpenAPI 3.0 document and Swagger UI
- GitHub Actions CI: install, typecheck, test, and `npm audit --audit-level=high`

### Phase 3A: multi-tenancy foundation

- Workspaces as the tenancy root, with OWNER membership and an auto-created personal workspace per user.
- `workspaceId` on workflows, executions, and audit logs; migration-safe tenant scoping keeps legacy `ownerId`-only rows reachable.
- Idempotent `npm run migrate` backfill that creates personal workspaces and stamps legacy data.
- Workspace API: `GET /api/workspaces`, `GET /api/workspaces/:id`, `POST /api/workspaces`, `PATCH /api/workspaces/:id`.
- `defaultWorkspaceId` returned by `/api/auth/register` and `/api/auth/login`.
- RBAC, collaboration, and analytics are deferred to later phases.

### Phase 6B: Enterprise Identity (SSO & SCIM)

- **Single Sign-On (SSO)**: OIDC (OpenID Connect) & SAML 2.0 Identity Provider configuration, PKCE authorization code grant with SHA-256 state/nonce cryptographic tokens, Redis transaction storage with atomic one-time consumption, and auto-provisioning with safe account identity linking.
- **Enterprise Domain Discovery**: Public discovery API (`/api/auth/sso/providers`) resolving IdPs by email domain, verified custom domain, or workspace ID.
- **SCIM 2.0 Inbound Provisioning**: RFC 7643 & RFC 7644 compliant endpoints (`/scim/v2/ServiceProviderConfig`, `/scim/v2/Users`) supporting user provisioning, filtering (`userName eq "..."`), pagination, patch operations, and workspace deprovisioning with Bearer token authentication.
- **Role Mapping & Safety Clamping**: Role claim translation (`ADMIN`, `EDITOR`, `VIEWER`) with automated `OWNER` clamping to protect tenant ownership.
- **Security & Cryptography**: AES-256-GCM encryption with initialization vector (IV) and authentication tag for stored IdP client secrets; SHA-256 hashing for SCIM bearer tokens; tenant-isolated secret projections.

#### Usage Guides

##### Configuring SSO Providers
SSO providers can be configured via the admin API:
```bash
POST /api/v1/admin/workspaces/:workspaceId/identity-providers
Content-Type: application/json
Authorization: Bearer <access_token>

{
  "type": "OIDC",
  "name": "Corporate Okta",
  "issuer": "https://acme.okta.com",
  "clientId": "client-id-123",
  "clientSecret": "secret-xyz",
  "authorizationEndpoint": "https://acme.okta.com/oauth2/v1/authorize",
  "tokenEndpoint": "https://acme.okta.com/oauth2/v1/token",
  "userinfoEndpoint": "https://acme.okta.com/oauth2/v1/userinfo",
  "domains": ["acme.com"],
  "domainVerificationStatus": "VERIFIED",
  "enforceSSO": true,
  "allowPasswordFallback": false,
  "roleMapping": {
    "Engineering": "EDITOR",
    "IT-Admin": "ADMIN"
  }
}
```

##### Initiating SSO Login
Users can initiate SSO login via the public endpoint:
```bash
POST /api/auth/sso/:providerId/start
Content-Type: application/json

{
  "redirectUri": "https://app.example.com/callback"
}
```

Response:
```json
{
  "authorizationUrl": "https://acme.okta.com/oauth2/v1/authorize?client_id=okta-client-123&response_type=code&scope=openid%20profile%20email&state=abc123&code_challenge=xyz789&code_challenge_method=S256",
  "state": "abc123"
}
```

##### SCIM Token Administration
SCIM tokens for inbound provisioning can be managed via:
```bash
# Generate SCIM token
POST /api/v1/admin/workspaces/:workspaceId/scim-tokens
Content-Type: application/json
Authorization: Bearer <access_token>

{
  "description": "Azure AD SCIM Integration",
  "expiresInDays": 180
}

# List SCIM tokens
GET /api/v1/admin/workspaces/:workspaceId/scim-tokens
Authorization: Bearer <access_token>

# Revoke SCIM token
DELETE /api/v1/admin/workspaces/:workspaceId/scim-tokens/:tokenId
Authorization: Bearer <access_token>
```

##### SCIM User Provisioning
Identity providers can provision users via SCIM:
```bash
# Provision new user
POST /scim/v2/Users
Authorization: Bearer <scim_token>
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "john.doe@enterprise.io",
  "emails": [{ "value": "john.doe@enterprise.io", "primary": true }],
  "name": { "givenName": "John", "familyName": "Doe" },
  "active": true,
  "roles": [{ "value": "EDITOR", "primary": true }]
}

# Fetch user
GET /scim/v2/Users/:id
Authorization: Bearer <scim_token>

# Update user
PATCH /scim/v2/Users/:id
Authorization: Bearer <scim_token>
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "replace", "path": "roles", "value": [{ "value": "ADMIN" }] },
    { "op": "replace", "path": "active", "value": false }
  ]
}

# Deprovision user
DELETE /scim/v2/Users/:id
Authorization: Bearer <scim_token>
```

### Phase 6C: Workflow Marketplace & Template Ecosystem

- **Reusable Workflow Templates**: Create, update, publish, archive, and clone pre-built workflows with categories (`Automation`, `Data Processing`, `Integration`, `AI Workflow`, `Approval Flow`, `Monitoring`, `Notifications`), rich metadata (documentation, icons, requirements, input variables), and configurable visibility (`PRIVATE`, `WORKSPACE`, `PUBLIC`, `MARKETPLACE`).
- **Immutable Template Versioning**: Version history tracking with SHA-256 graph hashing, visual node-level diff comparison (`GET /api/v1/templates/:id/compare?v1=1&v2=2`), and safe version rollback (`POST /api/v1/templates/:id/rollback`).
- **Template Installation**: One-click instantiation of templates into target workspaces as runnable workflows, validating tenant quotas and incrementing download/installation statistics.
- **Workflow Package Import/Export**: Portable `.json` workflow package bundle specification with SHA-256 checksum verification, schema validation, graph integrity checks, and prototype pollution defenses.
- **Marketplace Foundation & Ratings**: Publisher profiles (`displayName`, `description`, `verified`), multi-user rating system (1-5 stars with running average scoring and reviews), and full-text / multi-facet search across categories, tags, visibility, and keywords.
- **Role-Based Permissions & Audit Logging**: RBAC integration (`TEMPLATE_CREATE`, `TEMPLATE_PUBLISH`, `TEMPLATE_INSTALL`, `TEMPLATE_MANAGE`) and audit logs for all template lifecycle events (`TEMPLATE_CREATED`, `TEMPLATE_UPDATED`, `TEMPLATE_PUBLISHED`, `TEMPLATE_ARCHIVED`, `TEMPLATE_INSTALLED`, `TEMPLATE_EXPORTED`, `TEMPLATE_IMPORTED`, `TEMPLATE_RATED`).

#### Template Usage Guide

##### Creating a Workflow Template
```bash
POST /api/v1/templates
Content-Type: application/json
Authorization: Bearer <access_token>
x-workspace-id: <workspace_id>

{
  "name": "Stripe Payment Processor",
  "description": "Validates inbound payment webhooks and logs transaction records",
  "category": "Integration",
  "visibility": "WORKSPACE",
  "tags": ["stripe", "finance", "webhooks"],
  "metadata": {
    "icon": "credit-card",
    "documentation": "Configure webhook signature in secret variables",
    "requirements": ["webhook", "log"]
  },
  "workflowDefinition": {
    "nodes": [
      { "id": "trigger", "type": "webhook", "config": {} },
      { "id": "log", "type": "log", "config": { "message": "Payment verified" } }
    ],
    "edges": [
      { "source": "trigger", "target": "log" }
    ]
  }
}
```

##### Installing a Template into a Workspace
```bash
POST /api/v1/templates/:templateId/install
Content-Type: application/json
Authorization: Bearer <access_token>

{
  "workspaceId": "<target_workspace_id>",
  "workflowName": "Production Stripe Ingestion"
}
```

##### Exporting and Importing Workflow Packages
```bash
# Export template to package JSON
POST /api/v1/templates/:templateId/export
Authorization: Bearer <access_token>

# Import package JSON as new template
POST /api/v1/templates/import
Content-Type: application/json
Authorization: Bearer <access_token>
x-workspace-id: <workspace_id>

{
  "packageData": { ...exportedPackageJson },
  "visibility": "WORKSPACE"
}
```

##### Rating a Template
```bash
POST /api/v1/templates/:templateId/rate
Content-Type: application/json
Authorization: Bearer <access_token>

{
  "rating": 5,
  "review": "Seamless integration, worked out of the box!"
}
```


## Architecture

```text
src/
  api/
    app.ts
    openapi.ts
    server.ts
    middleware/
      cors.ts
      errorHandler.ts
      rateLimiter.ts
      requestLogger.ts
    routes/
      analyticsRoutes.ts
      executionRoutes.ts
      healthRoutes.ts
      templateRoutes.ts
      workflowRoutes.ts
      workspaceRoutes.ts
  auth/
    auth.controller.ts
    auth.middleware.ts
    auth.routes.ts
    auth.service.ts
    jwt.service.ts
    password.service.ts
    permissions.ts
  config/env.ts
  db/connection.ts
  engine/
    executeWorkflow.ts
    getReadyNodes.ts
    validateGraph.ts
  errors/
    templateErrors.ts
  migrate.ts
  models/
    AuditLogModel.ts
    DeadLetterModel.ts
    ExecutionAnalyticsModel.ts
    PublisherProfileModel.ts
    RefreshTokenModel.ts
    TemplateVersionModel.ts
    UserModel.ts
    WorkflowAnalyticsModel.ts
    WorkflowExecutionModel.ts
    WorkflowModel.ts
    WorkflowTemplateModel.ts
    WorkflowVersionModel.ts
    WorkspaceMemberModel.ts
    WorkspaceModel.ts
    WorkspaceUsageModel.ts
  observability/
    health.ts
    logger.ts
    workerHeartbeat.ts
  queues/
    bullMqExecutionQueue.ts
    executionQueue.ts
  schemas/
    executionSchema.ts
    workflowSchema.ts
  services/
    analyticsService.ts
    auditService.ts
    deadLetterService.ts
    executionService.ts
    templateService.ts
    workflowPackageService.ts
    workflowService.ts
    workspaceService.ts
  types/
    analytics.ts
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
CORS_ORIGINS=
RATE_LIMIT_MAX=1000
RATE_LIMIT_WINDOW_MS=60000
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

### Health and documentation

| Method | Path | Purpose | Success |
| --- | --- | --- | --- |
| `GET` | `/health` | Aggregated MongoDB, Redis, and worker-heartbeat report | `200` |
| `GET` | `/health/ready` | Readiness probe: MongoDB and Redis must be reachable | `200` |
| `GET` | `/health/live` | Liveness probe: the process is running | `200` |
| `GET` | `/api/openapi.json` | OpenAPI 3.0 document for this API | `200` |
| `GET` | `/api/docs` | Swagger UI for exploring this API | `200` |

`/health` returns `503` when MongoDB or Redis is unreachable, and `200` with `status: degraded` when only the worker heartbeat is missing. Health and documentation routes are public and are not rate limited.

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

### Analytics

| Method | Path | Purpose | Success |
| --- | --- | --- | --- |
| `GET` | `/api/analytics/workflows/:id` | Per-workflow totals, success/failure rates, retries, average duration (`WORKFLOW_READ`) | `200` |
| `GET` | `/api/analytics/executions/:executionId` | Single-execution duration, retries, node count, and per-node timings (`WORKFLOW_READ`) | `200` |
| `GET` | `/api/analytics/workspaces/:id` | Workspace usage: workflows, executions, monthly totals, success rate, storage (`AUDIT_READ`) | `200` |

Metrics are recorded automatically when an execution reaches a terminal status and when an execution is replayed. `recalculateAnalytics()` rebuilds every rollup from the stored executions.

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
    "message": "Invalid execution ID",
    "requestId": "6ac1f7f4-9d1f-4f4f-9c1b-2f7a2b6f4a11"
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

Unexpected errors return a generic `INTERNAL_ERROR` response. Every response carries an `x-request-id` header, and error responses repeat that id as `requestId`.

## Testing

The test suite covers graph execution, schema contracts, publishing, immutable snapshots, execution request validation, idempotency races, queue handoff failures, retry exhaustion, worker restart recovery, retry policies, execution timeouts, dead-letter records, execution replay, version pinning, status history, real BullMQ job processing, authentication and session management, auth rate limiting, audit logging, authorization isolation, the workspace API, the tenancy migration, and the analytics platform (workflow, execution, and workspace metrics with RBAC and tenant isolation), and the production hardening layer (security headers, CORS, global rate limiting, structured request logs with correlation ids, and health monitoring with worker heartbeats). Test services use `MongoMemoryReplSet` and `redis-memory-server`; no permanent test databases are required.

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
- The OpenAPI document is hand-maintained in `src/api/openapi.ts`; it is not generated from the route definitions, so it can drift
- Dead letters are replayed one execution at a time; there is no bulk redrive or automatic dead-letter processing

Those capabilities belong to later phases and are intentionally outside the current phase.
