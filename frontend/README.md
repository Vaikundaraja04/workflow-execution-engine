# Workflow Execution Engine - Frontend

Next.js 16 (App Router) client application for the Workflow Execution Engine backend.

## Prerequisites

- The backend API must be running on http://localhost:3000 (see the root README.md).
- The API must allow CORS from http://localhost:3001 (the default CORS_ORIGINS in .env.example).

## Setup

\\\ash
cd frontend
npm install
\\\

The dev script reads its API target from NEXT_PUBLIC_API_URL - keep it as the API origin only (no /api/v1 suffix):

\\\ash
npm run dev -- -p 3001   # or: npx next dev -p 3001
\\\

Open http://localhost:3001 in your browser.

## Required environment

rontend/.env.local needs only one variable (copy rontend/.env.example):

\\\
NEXT_PUBLIC_API_URL=http://localhost:3000
\\\

## Authentication

The client uses the shared services/apiClient (bearer access token + X-Workspace-Id
header, automatic 401 refresh against /api/v1/auth/refresh). Sign in at /login.
No extra frontend configuration is required.

## Building for production

\\\ash
npm run build
npm start        # serves the production build (keep the API running)
\\\

## Related docs

- Full run guide: docs/RUN_GUIDE.md
- Backend + stack overview: ../README.md (repo root)
- Audit findings: docs/AUDIT_GAP_REPORT.md