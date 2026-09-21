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

## Frontend Implementation (Phase 7A)

### Overview

The frontend is a modern web application built with Next.js 15, React, and TypeScript that provides an enterprise-grade interface for the Workflow Execution Engine. It implements a complete authentication flow, workspace management, dashboard analytics, and permission-aware UI components.

### Technology Stack

- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS with CSS variables for light/dark theme support
- **State Management**: 
  - Zustand for global state (auth, workspace, UI, analytics)
  - React Query/TanStack Query for server state
- **Forms**: React Hook Form with Zod validation
- **API Communication**: Axios with automatic token refresh and error handling
- **UI Components**: Custom component library with Radix UI primitives
- **Icons**: Lucide React
- **Testing**: Vitest with React Testing Library

### Architecture

```
frontend/
├── app/                    # Next.js app router
│   ├── (auth)/             # Authentication routes
│   ├── dashboard/          # Dashboard route
│   ├── layout.tsx          # Root layout
│   └── page.tsx            # Home page
├── components/             # Reusable components
│   ├── ui/                 # Base UI components (Button, Input, Modal, etc.)
│   ├── dashboard/          # Dashboard-specific widgets
│   └── WorkspaceSwitcher.tsx
├── lib/                    # Utility functions
│   ├── apiClient.ts        # Axios instance with interceptors
│   └── utils.ts            # Class name merging utility
├── services/               # API service layers
│   ├── authService.ts
│   ├── workspaceApi.ts
│   ├── workflowApi.ts
│   ├── executionApi.ts
│   └── analyticsApi.ts
├── stores/                 # Zustand state stores
│   ├── authStore.ts
│   ├── workspaceStore.ts
│   ├── uiStore.ts
│   └── analyticsStore.ts
├── types/                  # TypeScript interfaces
│   ├── auth.ts
│   ├── workspace.ts
│   ├── workflow.ts
│   ├── execution.ts
│   ├── analytics.ts
│   ├── audit.ts
│   ├── template.ts
│   ├── api.ts
│   ├── permissions.ts
│   └── index.ts
└── tests/                  # Vitest tests
    ├── auth.test.tsx
    ├── dashboard.test.tsx
    └── permissions.test.tsx
```

### Development Setup

1. **Prerequisites**:
   - Node.js >= 18
   - npm or yarn
   - Running backend server (on http://localhost:3000 by default)

2. **Environment Variables**:
   Create a `.env.local` file in the frontend directory:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:3000
   NEXT_PUBLIC_APP_URL=http://localhost:3001
   ```

3. **Installation**:
   ```bash
   cd frontend
   npm install
   ```

4. **Development Server**:
   ```bash
   npm run dev
   ```
   The frontend will be available at http://localhost:3001

5. **Production Build**:
   ```bash
   npm run build
   npm run start
   ```

### Component Library

The frontend includes a comprehensive set of reusable UI components:

- **Button**: Primary, secondary, ghost, destructive variants with loading states
- **Input**: Text, email, password inputs with labels, error states, and icon support
- **Modal**: Accessible modal with backdrop, escape key handling, and focus trapping
- **Card**: Flexible card component with header, title, description, content, and footer
- **DropdownMenu**: Radix UI-based dropdown menu with keyboard navigation
- **Table**: Responsive table for data display with sorting capabilities
- **Badge**: Status indicators for different states (success, warning, error, etc.)
- **Toast**: Notification system with success, error, warning, and info variants
- **Loading**: Spinner and skeleton components for loading states
- **EmptyState**: Component for displaying empty states with optional action buttons
- **ErrorState**: Error state component with retry option

### State Management

#### Authentication Store (`authStore`)
Manages user authentication state including:
- User profile data
- Access and refresh tokens
- Default workspace selection
- Authentication status and loading states
- Persists to localStorage for session persistence

#### Workspace Store (`workspaceStore`)
Handles workspace-related state:
- Current workspace information
- List of user's workspaces
- Current user role in workspace
- Workspace switching functionality

#### UI Store (`uiStore`)
Controls UI state:
- Sidebar visibility
- Theme preference (light/dark)
- Toast notifications queue
- Modal open/close states

#### Analytics Store (`analyticsStore`)
Caches analytics data:
- Workspace analytics
- Workflow performance metrics
- Execution statistics

### API Service Layer

Each service encapsulates API communication for a specific domain:

- **authService**: Authentication endpoints (login, register, refresh, logout)
- **workspaceApi**: Workspace and member management
- **workflowApi**: Workflow creation, editing, publishing
- **executionApi**: Workflow execution and monitoring
- **analyticsApi**: Analytics and reporting endpoints

All services use a shared Axios instance (`apiClient`) that provides:
- Automatic token refresh on 401 responses
- Request/response interceptors for logging and error handling
- Workspace context headers injection
- Centralized error mapping

### Permission System

The frontend implements role-based access control (RBAC) with:
- Permission checking utilities (`hasPermission` function)
- Role-based UI rendering (components conditionally render based on user permissions)
- Permission-aware API service calls
- Protected routes that redirect unauthenticated users

### Testing

Frontend tests are written with Vitest and React Testing Library:

- **Test Location**: `frontend/tests/`
- **Test Suites**:
  - Authentication tests (login, registration, error handling)
  - Dashboard tests (data rendering, loading states, error states)
  - Permission tests (role-based access control)
- **Running Tests**:
  ```bash
  # From repository root
  npm test
  
  # Or from frontend directory
  cd frontend
  npm run test
  ```

### Key Features Implemented

1. **Complete Authentication Flow**:
   - Login with email/password
   - Registration with validation
   - Automatic token refresh
   - Logout with session cleanup
   - Protected route guards

2. **Workspace Management**:
   - Workspace listing and selection
   - Persistent workspace preference
   - Workspace context propagation to API calls

3. **Dashboard Analytics**:
   - Workflow summary (total, published, draft counts)
   - Execution summary (success, failed, running counts)
   - Success rate calculation
   - Recent executions table
   - Recent audit events table

4. **Responsive Design**:
   - Mobile-friendly layout
   - Dark/light theme support via CSS variables
   - Accessible components (ARIA labels, keyboard navigation)

5. **Error Handling**:
   - Global error boundaries
   - Loading states for async operations
   - Retry mechanisms for failed requests
   - User-friendly error messages

### Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Base URL for backend API | `http://localhost:3000/api/v1` |
| `NEXT_PUBLIC_APP_URL` | Base URL for frontend application | `http://localhost:3001` |

### Building for Production

```bash
# Build for production
npm run build

# Start production server
npm run start
```

The production build optimizes:
- Bundle splitting and minification
- Image optimization
- Static asset hashing
- Server-side rendering optimization

### Browser Support

The frontend supports:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers (iOS Safari, Android Chrome)

## Visual Workflow Builder (Phase 7B)

### Overview

Phase 7B introduces an enterprise visual workflow designer powered by `@xyflow/react` (React Flow), Zustand, and React Hook Form + Zod. It enables visual authoring, real-time graph validation, node configuration, undo/redo history, JSON import/export, draft/publish lifecycle management, and visual version diffing.

### Key Capabilities

1. **Interactive Node Canvas (`@xyflow/react`)**:
   - Custom styled nodes with status badges, category coloring, icons, and connection handles (including dual True/False branches for condition logic).
   - Drag-and-drop node placement from palette with precise coordinate projection via `screenToFlowPosition`.
   - Smooth edge routing, minimap navigation, interactive background grid, and zoom/pan controls.

2. **Node Palette & Types**:
   - **Triggers**: Webhook Trigger (`webhook_trigger`), Manual Trigger (`manual_trigger`), Scheduled Trigger (`schedule_trigger`).
   - **Actions**: HTTP Request (`http_request`), Send Email (`email`), Database Query (`database_query`), Notification (`notification`), Logger (`log`).
   - **Logic**: Conditional Branching (`condition`), Delay / Sleep (`delay`).
   - **Marketplace**: Template Node (`installed_template`).

3. **Dynamic Properties Panel**:
   - Schema-driven node configuration forms using React Hook Form and Zod.
   - Real-time parameter updates reflecting immediately in the canvas state.

4. **Real-time Graph Validation Engine**:
   - Cycle detection via Depth-First Search (DFS) graph traversal.
   - Missing trigger detection and empty graph validation.
   - Disconnected / unreachable node warnings.
   - Dedicated validation panel with click-to-focus error navigation.

5. **History & State Management (Zustand)**:
   - Full Undo (`Ctrl+Z`) and Redo (`Ctrl+Y`) action stack (up to 20 snapshot levels).
   - Change tracking with visual dirty indicators.
   - Bidirectional serialization to/from backend `WorkflowDefinition` format.

6. **Draft, Publish & Version Diffing**:
   - Save Draft and Publish workflows with optional change summaries.
   - Version history and comparison page (`/workflows/[id]/versions`) displaying structural diffs (added, removed, modified nodes and edge changes).
   - JSON Workflow Export & Import with schema validation.

7. **RBAC Integration**:
   - Enforces `WORKFLOW_READ`, `WORKFLOW_UPDATE`, and `WORKFLOW_CREATE` permissions across builder toolbar, saving, and publishing actions.
   - Automatic read-only canvas mode for unauthorized or published historic versions.

## Execution Monitoring & Debug Console (Phase 7C)

### Overview

Phase 7C introduces a comprehensive execution monitoring and debug console that provides enterprise-grade visibility into workflow executions. Users can monitor execution states, debug failed workflows, inspect node-level execution, view logs, retry failed executions, replay executions, and manage dead letter queues.

### Key Features

#### 1. Execution List Page (`/executions`)
- Tabular view of all workflow executions with essential metadata
- Filtering by execution status (QUEUING, QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED, RETRYING)
- Date range filtering, workflow selection, and text search
- Pagination for large result sets
- Click-to-navigate to execution detail view

#### 2. Execution Detail Page (`/executions/:id`)
- **Header**: Workflow name, status badge, duration, and action controls
- **Live Status Tracker**: Real-time execution status with polling and WebSocket-ready hooks
- **Execution Timeline & Graph**: Interactive React Flow visualization showing node progression
- **Node Inspector**: Tabbed inspection of selected node inputs, outputs, errors, and metadata
- **Log Viewer**: Real-time terminal-style log display with filtering, timestamps, and export capabilities
- **Input/Output Viewer**: JSON payload inspection for initial triggers and final results
- **AI Failure Analysis Panel**: Root cause analysis for failed executions (permission-gated)
- **Execution Action Controls**: Retry, replay, and cancel operations with confirmation modals
- **Worker Status Drawer**: System-wide worker fleet metrics and queue depths

#### 3. Dead Letter Queue Management (`/dead-letters`)
- Listing of failed executions moved to the dead letter queue
- Failure reason, attempt counts, and timestamp information
- Retry functionality for DLQ executions
- Filtering and search capabilities

#### 4. Worker Monitoring Panel
- Real-time worker pool metrics (active/total workers)
- Queue depths for executions and webhooks
- Heartbeat latency monitoring
- Scaling recommendations based on workload

#### 5. State Management & Services
- **Zustand Store** (`executionStore.ts`): Centralized state for selected execution, filters, and UI state
- **API Service Layer** (`executionConsoleApi.ts`): Encapsulates all execution console API interactions
- **TypeScript Types**: Comprehensive typing for all execution console entities

### Technical Implementation

#### Frameworks & Libraries
- **Next.js 16** (App Router) with React 19 and TypeScript 5
- **Tailwind CSS 4** for styling
- **Zustand 5** for client-side state management
- **@tanstack/react-query** v5 for server state, caching, and background updates
- **@xyflow/react** v12 for interactive execution timeline visualization
- **Lucide React** for consistent iconography

#### Key Components
- `ExecutionTable`: Paginated, filterable execution list
- `ExecutionStatusTracker`: Live status updates with polling
- `ExecutionTimeline`: Interactive React Flow graph showing node progression
- `NodeInspector`: Tabbed inspector for node details (inputs/outputs/errors)
- `ExecutionLogs`: Terminal-style log viewer with filtering and export
- `FailureAnalysisPanel`: AI-powered failure diagnosis (requires `AI_ANALYSIS_READ`)
- `ExecutionActions`: Action toolbar with retry/replay/cancel (requires `WORKFLOW_EXECUTE`)
- `WorkerStatus`: Worker fleet monitoring dashboard
- `ExecutionFilters`: Reusable filter component for status, date range, workflow, and search

#### API Integrations
All execution console features reuse existing backend APIs:
- `GET /api/executions/:executionId` - Get execution details
- `GET /api/executions/:executionId/logs` - Retrieve execution logs
- `GET /api/workflows/:workflowId/executions` - List workflow executions
- `POST /api/executions/:executionId/retry` - Retry failed execution
- `POST /api/executions/:executionId/replay` - Replay completed execution
- `POST /api/executions/:executionId/cancel` - Cancel running execution
- `GET /api/workflows/:workflowId/dead-letters` - Get DLQ for workflow
- `GET /api/v1/ai/executions/:id/analyze` - AI failure analysis (Phase 6D)
- `GET /api/v1/admin/system/workers/metrics` - Worker fleet metrics

#### RBAC Integration
The execution console implements granular permission checking:
- **OWNER**: Full access to all features
- **ADMIN**: Workspace execution management and worker monitoring
- **EDITOR**: Execution control (retry/replay/cancel for permitted executions)
- **VIEWER**: Read-only access to execution traces and AI diagnostic insights

Specific permission gates:
- `WORKFLOW_EXECUTE`: Required for execution actions (retry, replay, cancel)
- `AI_ANALYSIS_READ`: Required for AI failure analysis panel
- Standard workflow permissions apply for execution listing and viewing

#### Testing
Comprehensive test suite covering:
- Execution list rendering and filtering functionality
- Execution detail status display and timeline rendering
- Execution action buttons and permission gating
- Log display and level filtering
- AI analysis panel RBAC permission enforcement
- Dead letter queue listing and retry operations
- Worker status panel rendering and metric display

### Component Architecture
```
frontend/
├── app/
│   ├── executions/                 # Execution list page
│   │   └── page.tsx
│   ├── executions/[id]/            # Execution detail page
│   │   └── page.tsx
│   └── dead-letters/               # Dead letter queue page
│       └── page.tsx
├── features/
│   └── execution-console/          # Execution console feature module
│       ├── components/             # Shared components
│       │   ├── ExecutionTable.tsx
│       │   ├── ExecutionStatusTracker.tsx
│       │   ├── ExecutionActions.tsx
│       │   └── FailureAnalysisPanel.tsx
│       ├── dashboard/              # Dashboard widgets
│       │   └── WorkerStatus.tsx
│       ├── inspector/              # Node inspection
│       │   └── NodeInspector.tsx
│       ├── logs/                   # Log viewing
│       │   └── ExecutionLogs.tsx
│       ├── timeline/               # Execution visualization
│       │   └── ExecutionTimeline.tsx
│       ├── stores/                 # State management
│       │   └── executionStore.ts
│       ├── types/                  # TypeScript definitions
│       │   └── types.ts
│       └── tests/                  # Component tests
│           └── executionConsole.test.tsx
├── services/
│   └── executionConsoleApi.ts      # API service layer
└── types/
    └── execution.ts                # Shared execution types
```

### Development & Usage
1. **Prerequisites**:
   - Node.js >= 18
   - npm or yarn
   - Running backend server (on http://localhost:3000 by default)

2. **Environment Variables**:
   Create a `.env.local` file in the frontend directory:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
   NEXT_PUBLIC_APP_URL=http://localhost:3001
   ```

3. **Installation**:
   ```bash
   cd frontend
   npm install
   ```

4. **Development Server**:
   ```bash
   npm run dev
   ```
   The frontend will be available at http://localhost:3001

5. **Production Build**:
   ```bash
   npm run build
   npm run start
   ```

### Key Features Summary
- **Monitoring**: Real-time execution status tracking with historical views
- **Debugging**: Node-level inspection, log viewing, and AI-powered failure analysis
- **Operations**: Retry failed executions, replay completed executions, cancel running executions
- **Management**: Dead letter queue handling and worker fleet monitoring
- **Insights**: Execution metrics, performance tracking, and optimization recommendations
- **Security**: Role-based access control protecting sensitive operations and data

### Monitoring Features
- Live execution status with automatic polling
- Execution duration tracking and timing metrics
- Retry count and attempt monitoring
- Trigger source and execution metadata
- Worker pool utilization and queue depths
- Heartbeat latency and system health indicators

### Debug Capabilities
- Interactive execution timeline visualization
- Node-by-node input/output inspection
- Error details and stack trace analysis
- Terminal-style log viewer with filtering and export
- AI-powered root cause analysis and resolution suggestions
- Payload comparison between initial input and final output

### API Integration Points
All features integrate with existing backend services:
- Execution CRUD operations via execution API
- Log retrieval and management
- Retry/replay/cancel workflow operations
- Dead letter queue management
- AI failure analysis (leveraging Phase 6D)
- Worker metrics and system monitoring (admin API)

### Performance Considerations
- Efficient data fetching with React Query caching
- Pagination for large execution lists
- Optimized React Flow rendering for complex workflows
- Selective log loading and virtual scrolling
- Memory-efficient state management with Zustand


## AI Copilot & Intelligence Console (Phase 7D)

### Overview

Phase 7D surfaces the Phase 6D AI Workflow Intelligence Platform in the frontend: natural language workflow generation, template generation with suggested metadata, workflow optimization, execution failure analysis, a builder-integrated copilot, and workspace AI usage reporting. Every AI surface is permission-gated, and generated artifacts stay in DRAFT state until they are explicitly saved.

### Key Features

#### 1. AI Workflow Generator (`/ai/workflow-generator`)
- Prompt input with example prompts and a 4000 character client-side limit
- Validated DRAFT preview with node, connection, category, and variable statistics
- Validation checklist covering graph validity, trigger presence, cycles, required fields, trigger count, and permissions
- "Create Draft" persists the workflow unpublished; "Edit in Builder" loads the graph into the visual builder without persisting

#### 2. AI Template Generator (`/ai/template-generator`)
- Generates a validated DRAFT workflow plus suggested template metadata (category, tags, visibility)
- Creates a PRIVATE template through the template API; publishing stays in the marketplace flow

#### 3. AI Workflow Optimization (`/ai/optimization`)
- Workspace workflow selector driving analysis per workflow
- Detected issues list with severity badges and affected node references
- Recommendation cards with impact estimates and suggested actions

#### 4. AI Failure Analysis (execution detail `/executions/[id]`)
- Root cause, affected nodes, error pattern, recommended fix, and a confidence badge
- Auto-runs for executions opened in the console; gated by `AI_ANALYSIS_READ`

#### 5. AI Copilot (workflow builder toolbar)
- Slide-over copilot panel launched from the visual workflow builder
- Prompt-driven generation with a chat transcript, DRAFT preview, and create-draft, regenerate, and discard controls
- One-click "Open Builder" loads the generated graph onto the canvas

#### 6. AI Usage & Configuration (`/ai/usage`)
- Request, token, and estimated cost rollups with a per-feature breakdown and recent records table
- Gated by `AI_CONFIGURATION_MANAGE` (OWNER and ADMIN)

### Technical Implementation

#### Frameworks & Libraries
- Next.js App Router with React 19 and TypeScript 5
- Zustand (`aiStore.ts`) for chat, generation, template, analysis, and optimization state
- `@xyflow/react` for read-only generated-graph previews
- Lucide React iconography with Tailwind CSS 4 styling

#### Key Components
- `WorkflowGenerator` / `TemplateGenerator`: prompt-driven generation flows
- `AICopilotPanel` / `AICopilotLauncher`: builder-integrated copilot drawer
- `ExecutionAIAnalysis`: failure diagnosis panel (execution console and detail pages)
- `WorkflowOptimizer`: optimization issues and recommendations
- `AIUsageDashboard`: usage rollups and records
- `WorkflowPreviewCard`, `WorkflowValidationChecklist`, `GeneratedWorkflowPreview`: DRAFT preview and validation
- `PromptInput`, `GenerationLoader`, `ConfidenceBadge`, `RecommendationCard`, `UsageCard`, `AIErrorState`, `AIChatMessage`: shared AI UI primitives

#### API Integrations
- `POST /api/v1/ai/workflows/generate` - generate a workflow draft from a prompt
- `POST /api/v1/ai/templates/generate` - generate a template draft with suggested metadata
- `GET /api/v1/ai/executions/:id/analyze` - failure analysis for an execution
- `POST /api/v1/ai/workflows/:id/optimize` - optimization issues and recommendations
- `GET /api/v1/ai/usage` - workspace AI usage records
- `POST /api/v1/templates` - persist a generated template
- `GET /api/v1/admin/ai/config`, `PATCH /api/v1/admin/ai/config` - workspace AI provider configuration

#### RBAC Integration
- `AI_WORKFLOW_CREATE`: workflow and template generation (OWNER, ADMIN, EDITOR)
- `AI_ANALYSIS_READ`: failure analysis (all workspace roles)
- `AI_OPTIMIZATION_CREATE`: optimization runs (OWNER, ADMIN, EDITOR)
- `AI_CONFIGURATION_MANAGE`: usage reporting and provider configuration (OWNER, ADMIN)

#### Testing
- `frontend/tests/aiFeatures.test.tsx` covers prompt submission, generation flows, validation checklist states, optimization rendering, failure analysis, usage reporting, permission gates, and usage aggregation (18 tests)
- `tests/aiRoutes.test.ts` covers the mounted AI endpoints end to end: authentication, RBAC allow and deny paths, DRAFT generation, hidden execution errors, usage listing, and configuration create and read (11 tests)

### Component Architecture
```
frontend/
├── app/ai/
│   ├── workflow-generator/page.tsx
│   ├── template-generator/page.tsx
│   ├── optimization/page.tsx
│   └── usage/page.tsx
├── features/ai/
│   ├── analysis/ExecutionAIAnalysis.tsx
│   ├── copilot/AICopilotPanel.tsx
│   ├── components/                 # Shared AI primitives (chat, prompt, badges, cards)
│   ├── hooks/                      # Generation, analysis, optimization, usage, permissions
│   ├── optimization/WorkflowOptimizer.tsx
│   ├── stores/aiStore.ts
│   ├── template-generation/TemplateGenerator.tsx
│   ├── types/types.ts
│   ├── usage/AIUsageDashboard.tsx
│   └── workflow-generation/        # Generator, preview, validation checklist
└── services/
    ├── aiApi.ts                    # AI endpoint service layer
    └── templateApi.ts              # Template creation service
```

## Phase 7E: Enterprise Collaboration & Real-Time Workspace Platform

### Overview

Phase 7E introduces a comprehensive real-time collaboration platform that enables multiple users to work together on workflows simultaneously with awareness of each other's activities. The platform includes real-time WebSocket infrastructure, threaded comments with mentions, workflow locking for concurrency control, notifications, activity feeds, and enhanced RBAC permissions.

### Key Features

#### 1. Real-Time Collaboration Infrastructure
- **Socket.IO with Redis Adapter**: Scalable real-time communication for workspace presence, cursor movements, and live updates
- **Presence Tracking**: Real-time visibility of online users, their avatars, cursor positions, and active node selections
- **Workspace Isolation**: Presence and collaboration data isolated by workspace for security and performance

#### 2. Workflow Comments & Discussions
- **Threaded Comments**: Hierarchical comment structure with parent-child relationships for discussions
- **@Mentions**: Notify specific users by mentioning them with @username syntax
- **Comment Resolution**: Mark comments as resolved/reopened to track discussion outcomes
- **Real-Time Updates**: Comments appear instantly for all collaborators via WebSocket
- **Edit/Delete**: Full CRUD operations on comments with audit logging

#### 3. Real-Time Workflow Editing Protection
- **Distributed Locking**: Prevent concurrent overwrites with automatic lock expiration
- **Heartbeat Mechanism**: Automatic lock renewal to prevent accidental release during active editing
- **Conflict Detection**: Visual indicators when another user has locked a workflow
- **Conflict Resolution Modal**: Options to view read-only, reload, or force takeover of locks
- **TTL-Based Expiry**: Automatic cleanup of stale locks to prevent deadlocks

#### 4. Notification Platform
- **Multi-Channel Delivery**: Real-time notifications via WebSocket and REST API
- **Notification Types**: Mentions, lock events, workflow shares, execution results, and system events
- **Read/Unread Tracking**: Visual indicators and unread counts for notification management
- **Real-Time Updates**: Instant notification delivery through WebSocket connections
- **Bulk Operations**: Mark all as read, delete, and filtering capabilities

#### 5. Enterprise Activity Feed
- **Comprehensive Timeline**: Chronological feed of all workspace activities
- **Rich Filtering**: Filter by resource type, action, user, and date range
- **Execution Tracking**: Workflow starts, completions, failures, and retries
- **Collaboration Events**: Comment creation, mentions, lock acquisitions, and shares
- **Security Events**: Permission changes, API key usage, and administrative actions
- **Audit Integration**: Reuses existing audit logging infrastructure where applicable

#### 6. RBAC Security Enhancements
- **New Collaboration Permissions**:
  - `COLLABORATION_READ`: View comments, presence, and activity feed
  - `COLLABORATION_COMMENT`: Create and edit comments, @mention users
  - `COLLABORATION_MANAGE`: Manage locks, delete comments, moderate discussions
- **Role Mapping**:
  - **OWNER**: Full access to all collaboration features
  - **ADMIN**: Manage collaboration features and moderate discussions
  - **EDITOR**: Create comments, participate in discussions, acquire locks
  - **VIEWER**: Read-only access to comments, presence, and activity feed
- **Workspace Isolation**: All collaboration data scoped to workspace for multi-tenancy

### Technical Implementation

#### Frameworks & Libraries
- **Socket.IO**: Real-time bidirectional communication between client and server
- **@socket.io/redis-adapter**: Redis-backed adapter for multi-instance scaling
- **Zustand**: Client-state management for collaboration state (online users, comments, notifications)
- **React Query/TanStack Query**: Server-state synchronization for REST APIs
- **Lucide React**: Consistent iconography for UI components

#### Key Components
- **PresenceTracker**: Displays online users and avatar stacks in workflow builder toolbar
- **CommentsPanel**: Threaded comment interface with @mention support and resolution controls
- **NotificationCenter**: Bell dropdown showing real-time notifications with mark-as-read/delete
- **ActivityFeed**: Filterable workspace activity timeline with pagination
- **ConflictResolver**: Modal dialog for handling lock conflicts with view/reload/force takeover options
- **UserAvatarStack**: Visual representation of multiple users' avatars with overlap handling
- **PresenceIndicator**: Visual indicator for user's own online/offline status

#### API Integrations
All collaboration features integrate with backend services:
- **Socket.IO Events**: Real-time presence, cursor, selection, comment, lock, and notification events
- **Comment REST API**: CRUD operations for workflow comments (`/api/v1/comments/*`)
- **Lock REST API**: Workflow locking mechanism (`/api/v1/locks/workflows/*`)
- **Notification REST API**: Notification management (`/api/v1/notifications/*`)
- **Activity REST API**: Activity feed retrieval (`/api/v1/activity/*`)
- **Presence REST API**: Workspace and workflow presence (`/api/v1/presence/*`)

#### RBAC Integration
The collaboration platform implements granular permission checking:
- **Comment Operations**: Require `COLLABORATION_COMMENT` for creation/editing, `COLLABORATION_READ` for viewing
- **Lock Operations**: Require `WORKFLOW_UPDATE` for acquisition/release, `COLLABORATION_MANAGE` for force takeover
- **Notification Access**: Require `COLLABORATION_READ` for viewing notifications
- **Activity Feed**: Require `COLLABORATION_READ` for accessing activity timeline
- **Presence Data**: Require `COLLABORATION_READ` for viewing user presence and cursors

### Component Architecture
```
frontend/
├── features/
│   └── collaboration/              # Collaboration feature module
│       ├── components/             # Shared UI components
│       │   ├── ActivityFeed.tsx
│       │   ├── CommentThread.tsx
│       │   ├── CommentsPanel.tsx
│       │   ├── ConflictResolver.tsx
│       │   ├── MentionInput.tsx
│       │   ├── NotificationCenter.tsx
│       │   ├── NotificationItem.tsx
│       │   ├── PresenceIndicator.tsx
│       │   ├── PresenceTracker.tsx
│       │   └── UserAvatarStack.tsx
│       ├── hooks/                  # Custom hooks for collaboration features
│       │   └── useCollaboration.ts
│       ├── stores/                 # Zustand stores
│       │   └── collaborationStore.ts
│       ├── types/                  # TypeScript definitions
│       │   └── collaboration.ts
│       └── tests/                  # Component tests
│           ├── activityFeed.test.tsx
│           ├── collaborationPresence.test.ts
│           ├── notificationPlatform.test.ts
│           ├── workflowComments.test.ts
│           └── workflowLocks.test.ts
├── services/
│   └── collaborationApi.ts         # API service layer for collaboration features
├── types/
│   └── collaboration.ts            # Shared collaboration types
└── src/
    ├── api/
    │   ├── routes/                 # API route handlers
    │   │   ├── activityRoutes.ts
    │   │   ├── commentRoutes.ts
    │   │   ├── lockRoutes.ts
    │   │   └── notificationRoutes.ts
    │   └── services/               # Business logic services
    │       ├── activityService.ts
    │       ├── commentService.ts
    │       ├── lockService.ts
    │       └── notificationService.ts
    ├── models/                     # Database models
    │   ├── ActivityLogModel.ts
    │   ├── NotificationModel.ts
    │   ├── WorkflowCommentModel.ts
    │   └── WorkflowLockModel.ts
    └── realtime/                   # Socket.IO real-time infrastructure
        ├── collaborationEvents.ts  # Event name constants and interfaces
        ├── socketAuth.ts           # Socket.IO authentication middleware
        ├── socketServer.ts         # Main Socket.IO server with Redis adapter
        ├── workspacePresence.ts    # Presence tracking and management
        └── socketUtils.ts          # Socket.IO utility functions
```

## Phase 8: Enterprise Security & Compliance Platform

### Overview

Phase 8 introduces an enterprise-grade security, data privacy, and compliance platform that equips the Workflow Execution Engine with real-time threat intelligence, cryptographic audit chains, automated compliance reporting, secrets management with envelope encryption, GDPR data subject rights workflows, and active session controls.

### Key Capabilities

#### 1. Security Center & Threat Detection
- **Dynamic Risk Scoring (0–100)**: Evaluates security posture across four weighted domains: Authentication (35%), Access Control (25%), Data Protection (20%), and Network Security (20%).
- **Automated Threat Detection Engine**: Scans for failed login brute-force attacks, suspicious privilege escalations, API rate limit abuse, and geo/anomalous access patterns.
- **Security Event Lifecycle**: Triaging and resolving security events with audit trails (`OPEN`, `INVESTIGATING`, `RESOLVED`, `FALSE_POSITIVE`).

#### 2. Cryptographic Immutable Audit Logging & Verification
- **SHA-256 Hash Chaining**: Every audit entry is cryptographically linked to the previous log entry (`prevHash` → `recordHash`).
- **HMAC-SHA256 Signatures**: Tamper-evident verification guaranteeing audit log integrity and chain validation.
- **Compliance Audit Exports**: Export audit trails in CSV and JSON formats with filters by user, action, and date range.

#### 3. GDPR Privacy & Data Subject Rights (Articles 17 & 20)
- **Data Portability (Article 20)**: User-initiated data export packaging personal data, workflow definitions, and execution history.
- **Right to be Forgotten (Article 17)**: Deletion request pipeline with configurable grace periods, PII anonymization, and workspace asset cleanup.
- **Consent & Retention Preferences**: Granular consent toggles for analytics, marketing, and crash diagnostics with retention period controls (indefinite, 3–36 months).

#### 4. Advanced Access Control & Session Management
- **Device & Session Tracking**: Browser, OS, IP address, device type, last active timestamp, and active status tracking.
- **Remote Revocation & Force Logout**: Single-session and bulk remote logout (`revoke-others`) with reason logging.
- **Workspace IP Allowlisting**: Enforce CIDR/IP allowlists with workspace-level policy toggles.
- **Two-Factor Authentication (MFA/TOTP)**: Built-in TOTP secret generation, QR/URI parameters, and token verification.

#### 5. Central Secrets Vault with Envelope Encryption
- **AES-256-GCM Encryption**: Secure at-rest encryption with initialization vectors (IV) and authentication tags.
- **Environment Isolation**: Separate secret namespaces across `development`, `staging`, and `production`.
- **Secret Lifecycle & Rotation**: Zero-downtime secret rotation with automatic versioning and access audit logging.
- **Sanitized Metadata Responses**: Plaintext values are never returned during listing operations.

#### 6. Compliance Reporting & Automated Evidence Collection
- **Multi-Framework Reporting**: Automated compliance evaluations for **SOC2 Type II**, **GDPR**, and **ISO27001**.
- **Automated Control Checks**: Validates MFA enforcement, IP allowlisting, encryption policies, audit log integrity, and retention rules.
- **Evidence Bundling & Export**: Structured compliance report generation and export in PDF and JSON formats.

#### 7. Hardened RBAC Security Matrix
Enterprise security permissions are strictly reserved for **OWNER** and **ADMIN** roles:
- `SECURITY_READ`: Access security dashboard, threat events, risk scores, and sessions
- `SECURITY_MANAGE`: Resolve security incidents, update security policies, trigger threat sweeps, manage retention
- `COMPLIANCE_EXPORT`: Generate and download SOC2, GDPR, and ISO27001 reports and policies
- `PRIVACY_MANAGE`: Initiate data exports, handle account deletion requests, manage privacy preferences
- `SECRETS_MANAGE`: Read, create, rotate, and delete encrypted secrets in the vault

### API Endpoints

#### Security Center (`/api/v1/security`)
- `GET /api/v1/security/dashboard` — Security center overview metrics (`SECURITY_READ`)
- `GET /api/v1/security/events` — Paginated security events (`SECURITY_READ`)
- `GET /api/v1/security/risk-score` — Dynamic risk score calculation (`SECURITY_READ`)
- `POST /api/v1/security/events/:id/resolve` — Resolve a security event (`SECURITY_MANAGE`)
- `POST /api/v1/security/threat-detection/run` — Trigger threat detection sweep (`SECURITY_MANAGE`)

#### Sessions & Policy (`/api/v1/sessions` & `/api/v1/security/policy`)
- `GET /api/v1/sessions` — List user's active sessions (`SECURITY_READ`)
- `POST /api/v1/sessions/:id/revoke` — Revoke a specific session (`SECURITY_MANAGE` / `PRIVACY_MANAGE`)
- `POST /api/v1/sessions/revoke-others` — Revoke all other active sessions (`SECURITY_MANAGE` / `PRIVACY_MANAGE`)
- `GET /api/v1/security/policy` — Get workspace security policy (`SECURITY_READ`)
- `PUT /api/v1/security/policy` — Update workspace security policy (`SECURITY_MANAGE`)
- `POST /api/v1/auth/mfa/setup` — Generate TOTP MFA setup credentials (`PRIVACY_MANAGE`)
- `POST /api/v1/auth/mfa/verify` — Verify TOTP MFA code (`PRIVACY_MANAGE`)

#### Privacy & GDPR (`/api/v1/privacy`)
- `POST /api/v1/privacy/export` — Request data export (`PRIVACY_MANAGE`)
- `POST /api/v1/privacy/delete-request` — Request account deletion (`PRIVACY_MANAGE`)
- `GET /api/v1/privacy/status` — Get privacy request status history (`PRIVACY_MANAGE`)
- `GET /api/v1/privacy/preferences` — Get privacy preferences (`PRIVACY_MANAGE`)
- `PUT /api/v1/privacy/preferences` — Update privacy preferences (`PRIVACY_MANAGE`)

#### Secrets Vault (`/api/v1/secrets`)
- `GET /api/v1/secrets` — List secrets metadata (`SECRETS_MANAGE`)
- `POST /api/v1/secrets` — Create encrypted secret (`SECRETS_MANAGE`)
- `GET /api/v1/secrets/:id` — Retrieve decrypted secret (`SECRETS_MANAGE`)
- `POST /api/v1/secrets/:id/rotate` — Rotate secret value (`SECRETS_MANAGE`)
- `DELETE /api/v1/secrets/:id` — Delete secret (`SECRETS_MANAGE`)

#### Compliance Reports (`/api/v1/compliance`)
- `GET /api/v1/compliance/reports/soc2` — Generate SOC2 report (`COMPLIANCE_EXPORT`)
- `GET /api/v1/compliance/reports/gdpr` — Generate GDPR report (`COMPLIANCE_EXPORT`)
- `GET /api/v1/compliance/reports/iso27001` — Generate ISO27001 report (`COMPLIANCE_EXPORT`)
- `GET /api/v1/compliance/retention-policies` — List retention policies (`COMPLIANCE_EXPORT`)
- `PUT /api/v1/compliance/retention-policies` — Set retention policy (`SECURITY_MANAGE`)
- `DELETE /api/v1/compliance/retention-policies/:resourceType` — Delete retention policy (`SECURITY_MANAGE`)

#### Audit Log Exports & Verification (`/api/v1/audit`)
- `GET /api/v1/audit/export` — Export audit logs as CSV/JSON (`AUDIT_READ`)
- `GET /api/v1/audit/verify-chain` — Verify cryptographic audit hash chain (`AUDIT_READ`)

### Frontend Architecture

```
frontend/
├── app/
│   ├── security/                   # Security Center routes
│   │   ├── page.tsx                # Security Dashboard
│   │   ├── audit/page.tsx          # Audit Log Explorer & Verification
│   │   ├── compliance/page.tsx     # Compliance Reports (SOC2, GDPR, ISO27001)
│   │   ├── policy/page.tsx         # Workspace Security Policy
│   │   ├── secrets/page.tsx        # Secrets Vault
│   │   └── sessions/page.tsx       # Session Manager
│   └── privacy/page.tsx            # GDPR Privacy Center
├── features/
│   └── security/
│       └── components/
│           ├── AuditExplorer.tsx
│           ├── ComplianceReport.tsx
│           ├── IpAllowlistSettings.tsx
│           ├── PrivacyCenter.tsx
│           ├── RiskScoreCard.tsx
│           ├── SecretsVaultView.tsx
│           ├── SecurityDashboard.tsx
│           └── SessionManager.tsx
├── services/
│   └── securityApi.ts              # Centralized Security API client
├── stores/
│   └── securityStore.ts            # Zustand security state store
└── types/
    └── security.types.ts           # Enterprise security type definitions
```

## Phase 9: Enterprise Operations, Analytics & Production Intelligence Platform

### Overview

Phase 9 transforms the Workflow Execution Engine into a full-scale enterprise operations system. It provides comprehensive observability telemetry, automated multi-format scheduled reporting, historical workspace analytics, audit log security intelligence, and an AI Operations Assistant for automated troubleshooting and capacity planning.

### Key Capabilities

#### 1. Enterprise Analytics Platform (Phase 9A)
- **High-Performance Aggregations**: Aggregated analytics across workflows, executions, usage, costs, and team activity with custom timeframes (`24h`, `7d`, `30d`, `90d`).
- **Execution & Latency Percentiles**: Granular calculation of median (p50), p90, p95, and p99 execution duration percentiles alongside hourly/daily throughput trends.
- **Node Failure Diagnostics**: Identifies top failing node types and specific node IDs with aggregated failure counts and error samples.
- **Cost Attribution**: Granular cost breakdown covering compute duration, AI token usage, and storage estimates with per-workflow cost attribution.
- **Multi-Format Export**: Asynchronous export of raw and aggregated analytics datasets in JSON and CSV formats.

#### 2. Advanced Reporting System (Phase 9B)
- **Multi-Domain Report Generation**: On-demand and scheduled reports across six enterprise domains: `EXECUTION`, `WORKFLOW_HEALTH`, `SECURITY`, `COMPLIANCE`, `USAGE`, and `COST`.
- **Flexible Format Support**: Native generation and export in `JSON`, `CSV`, and structured `PDF` formats.
- **Automated Scheduling**: Cron-compatible recurring execution schedules (`DAILY`, `WEEKLY`, `MONTHLY`) with recipient routing and next-run calculation.
- **Lifecycle Management**: Full report archiving, filtering, metadata tracking, and secure artifact download endpoints.

#### 3. Production Observability Dashboard (Phase 9C)
- **Real-Time Service Health**: Instant status and latency metrics for core infrastructure components: API gateway, MongoDB connection pools, Redis memory/clients, BullMQ queues, worker pool concurrency, and WebSockets.
- **Queue & Worker Telemetry**: Active, waiting, completed, and failed job counts with worker pool utilization tracking.
- **System Metrics Monitoring**: CPU usage, memory allocation, API request throughput (RPM), error rates, and p95 API response times.

#### 4. Enterprise Audit Intelligence (Phase 9D)
- **Automated Anomaly Scoring**: Calculates dynamic risk and anomaly scores (0–100) using pattern analysis over audit logs and session activity.
- **Threat Vector Detection**: Scans for credential stuffing / brute force login clusters, unauthorized privilege escalation spikes, and suspicious access anomalies.
- **Actionable Remediation**: Produces severity-graded security insights (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) paired with concrete remediation recommendations.

#### 5. Frontend Enterprise Operations Console (Phase 9E)
- **Executive Overview**: High-level KPI summary, SLA adherence, execution volume trends, and cost summary cards.
- **Workflow & Execution Analytics**: Interactive drill-downs for hourly throughput, latency distribution, retry statistics, and node failure breakdown.
- **Operations & Security Center**: Real-time system health cards, queue metrics, risk score indicators, and threat intelligence streams.
- **Report Studio**: Interactive report creator with schedule configuration, report catalog, and direct artifact downloads.

#### 6. AI Operations Assistant (Phase 9F)
- **Failure Diagnostics (`explainWorkflowFailure`)**: AI-powered root-cause analysis of failed execution runs with confidence scoring and step-by-step fix recommendations.
- **System Health Summary (`summarizeSystemHealth`)**: Generates executive health grades (`A` through `F`) with operational observations, immediate actions, and scaling advice.
- **Proactive Anomaly Detection (`detectSystemAnomalies`)**: Flags unusual queue buildups, error rate anomalies, and latency regressions.
- **Capacity & Scaling Advisory (`recommendScalingActions`)**: Recommends optimal worker concurrency and autoscaling targets based on active load.
- **Workflow Optimization (`suggestOptimizations`)**: Identifies parallelization, caching, retry policy, and timeout tuning opportunities.

### API Endpoints

#### Analytics (`/api/v1/analytics`)
- `GET /api/v1/analytics/overview` — High-level workspace overview metrics (`OPERATIONS_READ`)
- `GET /api/v1/analytics/workflows` — Workflow execution and node failure analytics (`OPERATIONS_READ`)
- `GET /api/v1/analytics/executions` — Execution throughput, latency percentiles, and retry stats (`OPERATIONS_READ`)
- `GET /api/v1/analytics/users` — User productivity and execution trigger volume (`AUDIT_READ`)
- `GET /api/v1/analytics/performance` — Response times and slowest workflow profiles (`OPERATIONS_READ`)
- `GET /api/v1/analytics/cost` — Compute, token, and storage cost breakdown (`AUDIT_READ`)
- `GET /api/v1/analytics/export` — Export analytics data in JSON or CSV format (`AUDIT_READ`)

#### Reports (`/api/v1/reports`)
- `POST /api/v1/reports` — Create or schedule a new report (`AUDIT_READ`)
- `GET /api/v1/reports` — List generated reports with status/type filters (`AUDIT_READ`)
- `GET /api/v1/reports/:id` — Get report details and data (`AUDIT_READ`)
- `DELETE /api/v1/reports/:id` — Delete a report (`AUDIT_READ`)
- `GET /api/v1/reports/:id/export` — Download report artifact (`AUDIT_READ`)

#### Operations & Observability (`/api/v1/operations`)
- `GET /api/v1/operations/health` — Service health and latency diagnostics (`OPERATIONS_READ`)
- `GET /api/v1/operations/metrics` — CPU, memory, API throughput, and queue depth telemetry (`OPERATIONS_READ`)
- `GET /api/v1/operations/system` — Comprehensive system status and environment summary (`OPERATIONS_READ`)

#### Audit Intelligence (`/api/v1/security`)
- `GET /api/v1/security/intelligence` — Retrieve threat level, risk score, and suspicious activity insights (`SECURITY_READ`)
- `POST /api/v1/security/intelligence/scan` — Run on-demand audit log security intelligence scan (`SECURITY_MANAGE`)

#### AI Operations Assistant (`/api/v1/ai/operations`)
- `POST /api/v1/ai/operations/explain-failure` — AI failure explanation and remediation (`AI_OPERATIONS_READ`)
- `POST /api/v1/ai/operations/system-summary` — AI system summary and health grade (`AI_OPERATIONS_READ`)
- `POST /api/v1/ai/operations/anomalies` — AI anomaly detection scan (`AI_OPERATIONS_READ`)
- `POST /api/v1/ai/operations/scaling-recommendations` — AI worker concurrency advisory (`AI_OPERATIONS_EXECUTE`)
- `POST /api/v1/ai/operations/suggest-optimizations` — AI workflow performance optimization suggestions (`AI_OPERATIONS_READ`)

### Frontend Architecture

```
frontend/
├── app/
│   └── operations/
│       ├── page.tsx                    # Operations Console & Executive Overview
│       ├── analytics/page.tsx          # Deep-Dive Analytics (Workflows, Executions, Cost)
│       ├── reports/page.tsx            # Report Studio & Schedule Manager
│       └── security/page.tsx           # Audit Intelligence & Risk Monitoring
├── features/
│   └── enterprise-operations/
│       ├── ExecutiveOverview.tsx       # Executive KPI summary cards
│       ├── ExecutionAnalytics.tsx      # Throughput, latency percentiles & retry stats
│       ├── WorkflowAnalytics.tsx       # Workflow performance & node failure breakdown
│       ├── CostAnalytics.tsx           # Compute & AI token cost breakdown
│       ├── SystemHealth.tsx            # Service connectivity & queue health cards
│       └── SecurityRiskWidget.tsx      # Risk score breakdown & suspicious activities
├── services/
│   └── operationsApi.ts                # Operations, Analytics, Report & AI API client
├── stores/
│   └── operationsStore.ts              # Zustand operations & analytics state store
└── types/
    └── operations.types.ts             # TypeScript definitions for Operations console
```
## Phase 12: Autonomous AI Operations Platform

Phase 12 turns the workflow engine into a self-operating platform: failures are remediated automatically, failures are predicted before they happen, AI spend is centrally governed, and agent nodes can orchestrate multi-step tool use. It spans five backend modules (12A–12D) plus a frontend integration layer (12E–12F).

### Module 12A: Autonomous Self-Healing & Closed-Loop Remediation
Detects execution failures, matches them against workspace-defined remediation policies, and executes (or proposes) fixes without human intervention.

- **SelfHealingService** — policy CRUD, incident evaluation, approve/reject workflows with an approval-token gate for high-risk actions
- Policies declare a `triggerCondition` (`ERROR_CODE_MATCH`, `TIMEOUT_PATTERN`, `RATE_LIMIT_EXCEEDED`, `DATA_VALIDATION_ANOMALY`), a `triggerValue`, and an `actionType` (`AUTO_RETRY_WITH_ADAPTED_PARAMS`, `CIRCUIT_BREAKER_TRIP`, `FALLBACK_ROUTE`, `PARAMETER_MUTATION_HEAL`)
- Incidents move through `DETECTED → PENDING_APPROVAL → EXECUTED | FAILED | REJECTED` and record remediation actions for audit
- Permissions: `SELF_HEALING_READ`, `SELF_HEALING_MANAGE`

### Module 12B: AI Agent Node & Multi-Agent Orchestration Framework
Executes LLM-driven agent nodes inside workflows.

- `AgentToolRegistry` — pluggable tool catalog invocable by agents
- `AgentRunnerService` — runs agent nodes with system prompts, tool-call loops, and execution traces
- Orchestrator modes: `autonomous`, `sequential`, and parallel fan-out with context-variable sharing
- Permissions: `AGENT_READ`, `AGENT_EXECUTE`

### Module 12C: Intelligent Multi-Model Router & Enterprise AI Governance
Central control plane for AI cost, security, and provider selection.

- `AIModelRouter` — per-workspace provider priority (`anthropic`, `openai`, `mock`), per-model config (max tokens, temperature, cost per 1K tokens, latency), and complexity-based routing rules
- Budget enforcement with alert / throttle / block thresholds on token and USD spend
- Prompt-injection detection, PII redaction, and prompt sanitization guardrails
- Permissions: `AI_GOVERNANCE_READ`, `AI_GOVERNANCE_MANAGE`, `AI_MODEL_ROUTER_READ`, `AI_MODEL_ROUTER_MANAGE`

### Module 12D: Predictive Operations & Autonomous Optimization
Forecasts failures before they occur and applies optimizations autonomously.

- `PredictiveOperationsService` — anomaly records with type (`execution_drift`, `sla_breach_risk`, …), severity, confidence score, predicted failure time, and recommended actions; acknowledge/delete lifecycle
- `AutonomousOptimizerService` — analyzes a workflow's definition + execution history, produces typed optimization recommendations (`caching_recommendation`, …) and applies them to the workflow draft

### Module 12E–12F: Operations Consoles (Frontend)
Wires the Phase 12A–12D backend APIs into two consoles with typed services, permission gating, and graceful demo fallback:

- `/operations/autonomous` — Autonomous Operations Console: live incident table, policy manager, and predictive radar with `Promise.allSettled` sync, optimistic updates with API fallback, and a read-only badge for roles without `SELF_HEALING_MANAGE`
- `/platform/ai-governance` — AI Governance Platform: budget card (cap + policy action updates), multi-model router provider rows, and routing strategy selection (`cost_optimized`, `latency_optimized`, `balanced`, `quality_optimized`)
- Service clients: `frontend/services/{selfHealingApi,predictiveOpsApi,aiGovernanceApi}.ts` (unwrap the `{ data }` envelope, forward `X-Workspace-Id`), with shared DTO→view-model mappers in `frontend/services/aiOperationsMappers.ts`
- Both consoles show a **Live API Telemetry** vs **Demo Data** badge depending on whether any API returned rows, so seeded demo data remains usable without a running backend

### Module 12.5: Autonomous Workflow Optimization Platform
Analyzes workflows against real execution telemetry, generates improvement plans, and applies them through an approval-gated, validation-first pipeline.

- **AutonomousOptimizationService** — 30-day execution profile (≤200 sampled executions) with per-node runs/failures/timeouts/average duration, p50/p95/p99 latency and trend, reliability and AI-cost estimates
- **Bottleneck detection** — redundant transitive edges, condition nodes without a false-branch fallback, slow nodes, failing nodes, timeout-heavy and retry-heavy execution windows
- **Recommendation engine** — cost/performance/reliability/architecture recommendations; only provably safe graph edits become actionable changes (`REMOVE_EDGE`, `ADD_EDGE` fallback, `UPDATE_NODE_CONFIG`, `ADD_NODE`), everything else is advisory with evidence; AI explanations are generated through the shared provider layer (`AIProviderFactory` + `AISecurityService`, usage metered via `AIUsageService`)
- **Plan lifecycle** — `PENDING → APPROVED | REJECTED → APPLIED | FAILED`; `approvalRequired` escalates for HIGH-risk changes, predictive failure risk ≥ 60 (via `PredictiveIntelligenceService`), or premium models with actionable changes
- **Safe apply** — deterministic change application, `WorkflowDefinitionSchema` + `validateGraph` validation, then a transactional DRAFT workflow version (next allocated number, `sourceVersionId` = published version) with a stored before/after diff; published versions are never touched and apply failures return 422 with validation details
- **Plan model** — `WorkflowOptimizationModel` (workspace-scoped, indexed by workspace/status/workflow)
- **Permissions** — `AI_OPTIMIZATION_READ`, `AI_OPTIMIZATION_CREATE`, `AI_OPTIMIZATION_APPROVE` (owners/admins full, editors read+create, viewers read)
- **Audit actions** — `AI_OPTIMIZATION_ANALYSIS_COMPLETED`, `AI_OPTIMIZATION_PLAN_CREATED|APPROVED|REJECTED|APPLIED|FAILED`
- **Frontend** — `/operations/optimization` dashboard: workflow picker, analysis card, plan detail with recommendations/impact/actions, and optimization history

## Phase 12 API Endpoints

### Self-Healing (`/api/v1/self-healing`)
- `GET /policies` — list policies (`SELF_HEALING_READ`)
- `POST /policies` — create policy (`SELF_HEALING_MANAGE`)
- `GET /policies/:id` / `PUT /policies/:id` / `DELETE /policies/:id` — policy detail (`SELF_HEALING_READ` / `SELF_HEALING_MANAGE`)
- `GET /incidents` — list incidents, filterable by `status` and `executionId` (`SELF_HEALING_READ`)
- `GET /incidents/:id` — incident detail (`SELF_HEALING_READ`)
- `POST /evaluate/:executionId` — evaluate a failed execution against policies (`SELF_HEALING_MANAGE`)
- `POST /incidents/:id/approve` — approve remediation with `{ token }` (`SELF_HEALING_MANAGE`)
- `POST /incidents/:id/reject` — reject remediation with `{ reason }` (`SELF_HEALING_MANAGE`)

### Predictive Operations (`/api/v1/predictive-operations`)
- `GET /anomalies` — list anomalies, filterable by `workflowId`, `anomalyType`, `severity`, `isAcknowledged`, `startTime`, `endTime` (`OPERATIONS_READ`)
- `POST /anomalies` — create an anomaly record (`OPERATIONS_MANAGE`)
- `PATCH /anomalies/:id/acknowledge` — acknowledge an anomaly (`OPERATIONS_MANAGE`)
- `DELETE /anomalies/:id` — delete an anomaly (`OPERATIONS_MANAGE`)
- `GET /workflows/:workflowId/optimizations` — analyze a workflow for optimizations (`OPERATIONS_READ`)
- `POST /workflows/:workflowId/optimizations/apply` — apply optimizations (`OPERATIONS_MANAGE`)

### AI Governance (`/api/v1/ai/governance`)
- `GET /budget` / `PUT /budget` — read/update AI spend limits and threshold policy (`AI_GOVERNANCE_READ` / `AI_GOVERNANCE_MANAGE`)
- `POST /budget/reset` — reset monthly usage counters (`AI_GOVERNANCE_MANAGE`)
- `GET /router/config` / `PUT /router/config` — read/update multi-model router configuration (`AI_MODEL_ROUTER_READ` / `AI_MODEL_ROUTER_MANAGE`)
- `POST /router/route` — resolve the optimal provider/model for a prompt and feature (`AI_MODEL_ROUTER_READ`)
- `POST /sanitize` — prompt-injection detection, sanitization, and PII redaction (`AI_GOVERNANCE_READ`)

### Agent Framework (`/api/v1/agent`)
- `GET /tools` — list registered agent tools (`AGENT_READ`)
- `POST /tools/execute` — execute a tool directly with `{ toolName, input }` (`AGENT_EXECUTE`)
- `POST /run` — run an agent node or multi-agent orchestration with `{ input, config, executionId, contextVariables }` (`AGENT_EXECUTE`)

### Workflow Optimization (`/api/v1/optimization`)
- `GET /workflows/:id/analyze` — execution profile + detected bottlenecks (`AI_OPTIMIZATION_READ`)
- `POST /workflows/:id/generate-plan` — generate a PENDING optimization plan (`AI_OPTIMIZATION_CREATE`)
- `GET /plans` — list plans, filterable by `status` and `workflowId` (`AI_OPTIMIZATION_READ`)
- `GET /plans/:id` — plan detail (`AI_OPTIMIZATION_READ`)
- `POST /plans/:id/approve` — approve with `{ note }` (`AI_OPTIMIZATION_APPROVE`)
- `POST /plans/:id/reject` — reject with `{ reason }` (`AI_OPTIMIZATION_APPROVE`)
- `POST /plans/:id/apply` — validate changes and create a DRAFT workflow version; responds 422 with validation details when the candidate definition is invalid (`AI_OPTIMIZATION_CREATE`)

All Phase 12 responses use the standard `{ data }` envelope and are scoped via the `X-Workspace-Id` header.

## Phase 12.9: Enterprise Release Readiness & Production Hardening

Validation and hardening phase: prove the platform is production-ready across eight
dimensions (security, performance, reliability, deployment, monitoring, backup, disaster
recovery, documentation) and turn the results into machine-readable reports, a readiness
console and an operations runbook.

### Readiness API (`/api/v1/release-readiness`)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/security-audit` | `SECURITY_READ` | Deterministic audit (8 families, 17 checks) with 0-100 score, findings and severities |
| GET | `/performance` | `OPERATIONS_MANAGE` | 5-iteration benchmark battery over real data paths with explicit thresholds |
| GET | `/database` | `OPERATIONS_READ` | Schema-declared index verification and collection growth watch |
| GET | `/disaster-recovery` | `OPERATIONS_MANAGE` | Snapshot + restore dry-run + recovery estimate (RTO 4h / RPO 24h) |
| GET | `/deployment` | `OPERATIONS_READ` | Validates `deploy/k8s/production` manifests and queue/worker wiring |
| GET | `/metrics?windowHours=` | `OPERATIONS_READ` | Enterprise metrics: latency, throughput, AI cost, agent execution, marketplace activity |
| GET | `/readiness` | `OPERATIONS_READ` | Weighted aggregate score with per-dimension status |

All responses use the standard `{ data }` envelope. Every run writes to the audit chain
(`SECURITY_AUDIT_COMPLETED`, `PERFORMANCE_TEST_COMPLETED`, `BACKUP_VALIDATED`,
`DR_TEST_COMPLETED`, `DEPLOYMENT_READINESS_CHECKED`).

### Deployment guide

1. **Secrets** - create `workflow-engine-secrets` with `mongodb-uri`, `redis-url`,
   `auth-jwt-secret` (>= 32 chars) and `webhook-secret-key` (>= 32 chars). The webhook
   key removes the HIGH fallback-key finding from the security audit.
2. **Apply** - `kubectl apply -k deploy/k8s/production` (namespace, secrets and ordered
   apply steps are documented in `deploy/k8s/production/README.md`).
3. **Verify** - `kubectl rollout status`, then call
   `GET /api/v1/release-readiness/deployment` and `GET /api/v1/release-readiness/readiness`.
4. **Load test** - run the scripts in `tests/load` against the deployed instance and
   compare with the documented expected limits.
5. **Rollback** - `kubectl rollout undo` for image rollbacks; revert the kustomization
   tag or previous git revision for manifest rollbacks (details in the overlay README).

### Documentation

- Operations runbook: [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) -
  scoring model, audit checks, benchmark thresholds, DR drill, pre-release checklist.
- Kubernetes overlay: [`deploy/k8s/production/README.md`](deploy/k8s/production/README.md).
- Load tests: [`tests/load/README.md`](tests/load/README.md).

### Frontend

`/platform/readiness` readiness console: aggregate score with per-dimension cards,
SecurityScoreCard (findings + severities), PerformanceCard (operation thresholds),
DeploymentStatus (manifests + queue/worker checks), DatabaseHealth (indexes + growth
watch) and DRStatus (backup validation, recovery estimate), with on-demand DR drill and
benchmark actions.

## License

ISC
