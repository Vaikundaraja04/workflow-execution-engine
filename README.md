# Workflow Execution Engine

A TypeScript workflow engine with runtime validation, graph execution, and a MongoDB-backed API for draft and immutable published workflow versions.

This repository is being built in small, reviewable phases as a backend portfolio project.

## Implemented scope

### Phase 1: execution engine

- Webhook, condition, and log nodes
- Directed-graph validation
- Deterministic topological execution
- True/false condition branches
- `SKIPPED` states for branches that are not selected
- Execution outputs and complete transition history

### Phase 2A: runtime contracts

- Strict Zod schemas for untrusted workflow JSON
- Type-safe public parsing helpers
- Schema validation before graph validation or execution
- Stable error codes for invalid workflows

### Phase 2B: persistence API

- Express 5 JSON API
- MongoDB persistence through Mongoose
- Editable workflow drafts
- Explicit validation endpoint
- Transactional publishing
- Immutable, sequential workflow versions
- Centralized safe JSON errors
- Integration tests using an in-memory MongoDB replica set

## Architecture

```text
src/
  api/
    app.ts
    server.ts
    middleware/errorHandler.ts
    routes/workflowRoutes.ts
  config/env.ts
  db/connection.ts
  engine/
    executeWorkflow.ts
    getReadyNodes.ts
    validateGraph.ts
  examples/booking-workflow.json
  models/
    WorkflowModel.ts
    WorkflowVersionModel.ts
  schemas/workflowSchema.ts
  services/workflowService.ts
  types/workflow.ts
  demo.ts
  index.ts
tests/
```

The execution engine remains independent from Express and MongoDB. The API layer manages workflow definitions and versions; it does not yet expose an execution endpoint.

## Requirements

- Node.js 20.19 or newer
- npm
- MongoDB replica set for the publish endpoint

MongoDB transactions require a replica set. MongoDB Atlas satisfies this requirement. For local development, start MongoDB as a single-node replica set before publishing workflows.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and provide your MongoDB connection string:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/workflow_engine?replicaSet=rs0
PORT=3000
```

The API loads `.env` automatically when the file exists. Existing process environment variables keep their values.

## Commands

```bash
npm run dev        # run the Phase 1 booking workflow demo
npm run dev:api    # run the API in watch mode
npm run start:api  # run the API once
npm test           # run all unit and integration tests
npm run test:watch # run tests in watch mode
npm run typecheck  # check TypeScript without emitting files
```

## API endpoints

| Method | Path | Purpose | Success |
| --- | --- | --- | --- |
| `GET` | `/health` | Health check | `200` |
| `POST` | `/api/workflows` | Create a workflow draft | `201` |
| `GET` | `/api/workflows/:id` | Get a workflow and its current draft | `200` |
| `PUT` | `/api/workflows/:id/draft` | Update a draft name or definition | `200` |
| `POST` | `/api/workflows/:id/validate` | Validate the draft schema and graph | `200` |
| `POST` | `/api/workflows/:id/publish` | Publish an immutable version | `201` |
| `GET` | `/api/workflows/:id/versions` | List published versions in ascending order | `200` |

Request bodies are strict: missing fields, unknown fields, invalid workflow shapes, empty updates, and malformed JSON are rejected with safe error responses.

### Create a workflow

```json
{
  "name": "Booking approval",
  "definition": {
    "nodes": [
      { "id": "trigger", "type": "webhook", "config": {} },
      { "id": "log", "type": "log", "config": { "message": "Booking received" } }
    ],
    "edges": [
      { "source": "trigger", "target": "log" }
    ]
  }
}
```

### Error shape

```json
{
  "error": {
    "code": "INVALID_WORKFLOW_ID",
    "message": "Invalid workflow ID"
  }
}
```

Expected client and domain errors use `400`, `404`, `409`, or `422`. Unexpected failures return a generic `500` response without database or stack-trace details.

## Draft and version lifecycle

1. Create or edit a draft.
2. Validate its schema and graph.
3. Publish it inside a MongoDB transaction.
4. Store a deep, immutable version snapshot with the next version number.
5. Continue editing the draft without changing earlier published versions.

Publishing rejects invalid schema and invalid graph definitions. A unique compound index on workflow ID and version number protects version numbering from duplicates.

## Runtime validation API

```ts
import { safeParseWorkflowDefinition } from 'workflow-execution-engine';

const result = safeParseWorkflowDefinition(jsonInput);
if (!result.success) {
  console.error(result.error.issues);
}
```

## Testing

The suite covers the execution engine, schema contracts, graph validation, API request validation, safe errors, persistence, publishing, version ordering, and snapshot immutability. API tests use `MongoMemoryReplSet`, so transaction behavior is tested without a permanent test database.

## Current limitations

- Single-user system with no authentication or authorization
- No API endpoint for workflow execution
- No job queue, workers, retries, or scheduled execution
- No React interface
- No production deployment or Docker configuration

Those capabilities belong to later phases and are intentionally outside Phase 2B.
