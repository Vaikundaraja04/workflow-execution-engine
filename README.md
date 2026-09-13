# Workflow Execution Engine

## Purpose
In-memory headless workflow execution engine for TypeScript (Phase 1).

## Phase 1 Scope
In-memory only. Supports webhook, condition, log nodes. Graph validation, topological execution, history tracking.

## Folder Structure
```
src/
  index.ts
  types/workflow.ts
  engine/
    validateGraph.ts
    getReadyNodes.ts
    executeWorkflow.ts
  examples/booking-workflow.json
tests/
README.md
```

## Installation
```
npm install
```

## Commands
- `npm run dev`
- `npm test`
- `npm run test:watch`
- `npm run typecheck`

## Example Workflow
See src/examples/booking-workflow.json

## Branch Selection and SKIPPED Behavior
Condition nodes evaluate and activate only the matching true/false edge. The other branch nodes transition PENDING -> SKIPPED and produce no output. History records all transitions including PENDING -> READY -> RUNNING -> SUCCEEDED and PENDING -> SKIPPED.

## npm run dev
Executes demo with booking-workflow.json for estimatedCost 15000 and 5000, printing selected/skipped branches.

## Limitations (Phase 1)
No persistence, no external services, no parallelism beyond sequential ready sets.

## Planned Phase 2
Persistence, BullMQ queues, API server, auth, React UI, Docker.

## Phase 2A: Runtime Validation
Workflow JSON is untrusted. Zod schemas enforce strict structure at runtime.

Use:
```ts
import { safeParseWorkflowDefinition } from 'workflow-execution-engine';
const result = safeParseWorkflowDefinition(jsonInput);
if (!result.success) { /* handle error */ }
```

Rules: non-empty ids, exact node types, strict condition/log/webhook configs, true/false edge conditions only from condition nodes, duplicate edge detection.

Validation failure returns INVALID_WORKFLOW_SCHEMA with details.

MongoDB, Express, BullMQ, auth, UI not part of Phase 2A.
