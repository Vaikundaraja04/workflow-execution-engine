# Workflow Execution Engine

## Overview

This is a workflow execution engine that allows users to create, manage, and execute workflows. The engine supports features such as:

- Workflow creation and editing
- Workflow execution with retry policies
- Workflow versioning
- Workflow templates
- Role-based access control (RBAC)
- Audit logging
- AI-powered workflow intelligence (Phase 6D)

## Phase 6D: AI Workflow Intelligence Platform

This phase adds an AI layer over the existing workflow execution engine with the following capabilities:

### Natural Language Workflow Generation
Converts user prompts into valid workflow definitions (marked as `DRAFT` and `isPublished: false`).

### AI-Powered Failure Analysis
Analyzes failed executions to provide root cause identification, affected step analysis, and concrete fix recommendations.

### Workflow Optimization Suggestions
Analyzes workflow definitions alongside historical execution metrics to recommend performance and structural improvements.

### Template Generation
Produces workflow drafts with suggested categories, tags, and metadata.

### AI Security and Guardrails
- Prompt length limits (4000 max)
- Prompt injection pattern neutralization (`[FILTERED_INSTRUCTION]`)
- Sensitive data masking (`[REDACTED_API_KEY]`, `[REDACTED_PASSWORD]`, `[REDACTED_TOKEN]`, `[REDACTED_AWS_KEY]`, `[REDACTED_PRIVATE_KEY]`)
- Recursive metadata redaction
- Strict graph/schema validation

### AI Provider Abstraction
Pluggable provider architecture (`OpenAIProvider`, `AnthropicProvider`, `MockAIProvider`) managed through `AIProviderFactory`.

### Workspace AI Configuration
Configurable per workspace with AES-256-GCM encrypted API key storage.

### Usage & Audit Logging
Tracking of token consumption, request counts, estimated costs, and comprehensive audit logs.

### RBAC Integration
Custom AI permissions (`AI_WORKFLOW_CREATE`, `AI_ANALYSIS_READ`, `AI_OPTIMIZATION_CREATE`, `AI_CONFIGURATION_MANAGE`) mapped across roles.

## API Endpoints

### Workflow Generation
- `POST /api/v1/ai/workflows/generate` - Generate a workflow from a natural language prompt
  - Requires: `AI_WORKFLOW_CREATE` permission
  - Body: `{ prompt: string }`
  - Returns: `{ draftWorkflow, validation, suggestedTemplateName }`

### Failure Analysis
- `GET /api/v1/ai/executions/:id/analyze` - Analyze a failed execution
  - Requires: `AI_ANALYSIS_READ` permission
  - Returns: `{ summary, rootCause, affectedNode, suggestedFix, confidence }`

### Workflow Optimization
- `POST /api/v1/ai/workflows/:id/optimize` - Get optimization suggestions for a workflow
  - Requires: `AI_OPTIMIZATION_CREATE` permission
  - Returns: `{ issues, recommendations, estimatedImprovement }`

### Template Generation
- `POST /api/v1/ai/templates/generate` - Generate a template from a natural language prompt
  - Requires: `AI_WORKFLOW_CREATE` permission
  - Body: `{ prompt: string }`
  - Returns: `{ draftWorkflow, validation, templateMetadata }`

### Usage
- `GET /api/v1/ai/usage` - Get AI usage records for the current user in the workspace
  - Requires: `AI_CONFIGURATION_MANAGE` permission
  - Returns: Array of usage records

### AI Configuration (Admin)
- `GET /api/v1/admin/ai/config` - Get AI configuration for the workspace
  - Requires: `AI_CONFIGURATION_MANAGE` permission
  - Returns: AI configuration (without encrypted API key)
- `PATCH /api/v1/admin/ai/config` - Update AI configuration for the workspace
  - Requires: `AI_CONFIGURATION_MANAGE` permission
  - Body: `{ provider, model, temperature, maxTokens, features, apiKey }`
  - Returns: Updated AI configuration (without encrypted API key)

## Getting Started

1. Install dependencies: `npm install`
2. Start the development server: `npm run dev`
3. Run tests: `npm test`
4. Run type checking: `npm run typecheck`

## License

MIT