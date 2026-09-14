# Workflow Execution Engine

A strict TypeScript workflow platform that validates directed graphs, publishes immutable workflow versions, and executes those versions through durable MongoDB records and BullMQ workers.

The project is built in small, reviewable phases as an advanced backend portfolio project.

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

## Architecture

```text
src/
  api/
    app.ts
    server.ts
    middleware/errorHandler.ts
    routes/
      executionRoutes.ts
      workflowRoutes.ts
  config/env.ts
  db/connection.ts
  engine/
    executeWorkflow.ts
    getReadyNodes.ts
    validateGraph.ts
  models/
    WorkflowExecutionModel.ts
    WorkflowModel.ts
    WorkflowVersionModel.ts
  queues/
    bullMqExecutionQueue.ts
    executionQueue.ts
  schemas/
    executionSchema.ts
    workflowSchema.ts
  services/
    executionService.ts
    workflowService.ts
  types/
    execution.ts
    workflow.ts
  workers/
    executionWorker.ts
    startWorker.ts
```

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
```

The API and worker load `.env` automatically when it exists. Existing process environment variables retain their values.

## Commands

```bash
npm run dev          # run the original booking-workflow demo
npm run dev:api      # API with file watching
npm run dev:worker   # worker with file watching
npm run start:api    # API once
npm run start:worker # worker once
npm test             # all unit and integration tests
npm run test:watch   # Vitest watch mode
npm run typecheck    # strict TypeScript check
```

Run the API and worker in separate terminals. Both processes require MongoDB and Redis.

## API endpoints

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

### Executions

| Method | Path | Purpose | Success |
| --- | --- | --- | --- |
| `POST` | `/api/workflows/:id/executions` | Queue the latest published version | `202` |
| `GET` | `/api/executions/:executionId` | Get status, result, error, and history | `200` |
| `GET` | `/api/workflows/:id/executions` | List executions newest first | `200` |

### Queue an execution

```json
{
  "input": {
    "estimatedCost": 15000
  },
  "idempotencyKey": "booking-123"
}
```

The first request creates an execution and queues a deterministic job. Repeating the same key with equivalent JSON input returns the same execution without creating a second job. Reusing the key with different input returns `IDEMPOTENCY_CONFLICT`.

If Redis rejects the enqueue operation, the record becomes `FAILED` with `QUEUE_UNAVAILABLE`; retrying the same request reuses and re-enqueues that execution. API and worker startup also reconcile records stranded in `QUEUING` during an earlier process failure.

## Execution lifecycle

```text
QUEUING -> QUEUED -> RUNNING -> SUCCEEDED
                          \-> FAILED
```

Transient worker failures return the record to `QUEUED` and BullMQ retries with exponential backoff. A terminal failure stores a stable error without exposing the thrown message or stack. Each worker attempt is recorded in `statusHistory`.

The execution stores both `workflowVersionId` and `versionNumber`. Draft edits and later publications cannot change the definition already selected for an execution.

## Error shape

```json
{
  "error": {
    "code": "INVALID_EXECUTION_ID",
    "message": "Invalid execution ID"
  }
}
```

Execution-specific error codes include:

- `INVALID_EXECUTION_ID`
- `EXECUTION_NOT_FOUND`
- `NO_PUBLISHED_VERSION`
- `IDEMPOTENCY_CONFLICT`
- `QUEUE_UNAVAILABLE`

Unexpected errors return a generic `INTERNAL_ERROR` response.

## Testing

The test suite covers graph execution, schema contracts, publishing, immutable snapshots, execution request validation, idempotency races, queue handoff failures, retry exhaustion, worker restart recovery, version pinning, status history, and real BullMQ job processing. Test services use `MongoMemoryReplSet` and `redis-memory-server`; no permanent test databases are required.

```bash
npm run typecheck
npm test
npm audit --audit-level=high
```

## Current limitations

- Single-user system without authentication or authorization
- No scheduled or cron-triggered workflows
- No React visual workflow builder
- No multi-tenant isolation
- No production deployment, Docker configuration, or distributed tracing

Those capabilities belong to later phases and are intentionally outside Phase 2C.
