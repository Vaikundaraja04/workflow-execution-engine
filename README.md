# Workflow Execution Engine

## Purpose
Production-quality in-memory headless workflow execution engine for TypeScript.

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

## Limitations (Phase 1)
No persistence, no external services, no parallelism beyond sequential ready sets.

## Planned Phase 2
Persistence, BullMQ queues, API server, auth, React UI, Docker.
