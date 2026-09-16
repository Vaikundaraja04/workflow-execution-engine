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

## License

parameter>