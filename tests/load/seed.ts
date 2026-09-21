// Phase 12.10 - seeds a real account, workspace, published workflow and API key
// for the load suite, then writes tests/load/seed-output.json for run-all.mjs.
// Usage: npx tsx tests/load/seed.ts
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

interface SeedResponse {
  status: number;
  body: Record<string, unknown>;
  raw: string;
}

interface CallOptions {
  body?: unknown;
  token?: string;
  workspaceId?: string;
}

async function call(method: string, pathname: string, options: CallOptions = {}): Promise<SeedResponse> {
  const init: RequestInit = {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.workspaceId ? { 'x-workspace-id': options.workspaceId } : {}),
    },
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const raw = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  return { status: response.status, body: (parsed ?? {}) as Record<string, unknown>, raw };
}

function requireStatus(response: SeedResponse, expected: number, step: string): Record<string, unknown> {
  if (response.status !== expected) {
    console.error(`Seed step failed (${step}): HTTP ${response.status}`);
    console.error(response.raw);
    process.exit(1);
  }
  return response.body;
}

const WORKFLOW_DEFINITION = {
  nodes: [
    { id: 'start', type: 'webhook', config: {} },
    { id: 'log', type: 'log', config: { message: 'load test execution' } },
  ],
  edges: [{ source: 'start', target: 'log' }],
};

async function bumpRateLimits(apiKeyId: string, token: string, workspaceId: string): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    try {
      const mongoose = (await import('mongoose')).default;
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      const db = mongoose.connection.db;
      if (db) {
        const result = await db.collection('apikeys').updateOne(
          { _id: new mongoose.Types.ObjectId(apiKeyId) },
          { $set: { 'rateLimit.requestsPerMinute': 100000, 'rateLimit.executionsPerHour': 1000000 } },
        );
        if (result.matchedCount === 1) {
          console.log('Raised API key rate limits directly in MongoDB for the load run');
        }
      }
      await mongoose.disconnect();
      return;
    } catch (error) {
      console.warn(
        'Direct rate-limit bump failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const patched = await call('PATCH', `/api/v1/keys/${apiKeyId}/limits`, {
    body: { requestsPerMinute: 10000, executionsPerHour: 100000 },
    token,
    workspaceId,
  });
  if (patched.status !== 200) {
    console.warn(`Could not raise API key limits (HTTP ${patched.status}); expect 429s under load`);
  }
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const email = process.env.LOAD_EMAIL ?? `load-${stamp}@workflow.test`;
  const password = process.env.LOAD_PASSWORD ?? 'LoadTestPass123!';

  requireStatus(await call('POST', '/api/auth/register', { body: { email, password } }), 201, 'register');

  const login = requireStatus(await call('POST', '/api/auth/login', { body: { email, password } }), 200, 'login');
  const token = typeof login.accessToken === 'string' ? login.accessToken : '';
  const workspaceId = typeof login.defaultWorkspaceId === 'string' ? login.defaultWorkspaceId : '';
  if (!token || !workspaceId) {
    console.error('Login response did not include an access token and default workspace');
    process.exit(1);
  }
  const workflow = requireStatus(
    await call('POST', '/api/workflows', {
      body: { name: `Load Test Workflow ${stamp}`, definition: WORKFLOW_DEFINITION },
      token,
      workspaceId,
    }),
    201,
    'create workflow',
  );
  const workflowId = typeof workflow._id === 'string' ? workflow._id : '';
  if (!workflowId) {
    console.error('Workflow response did not include an id');
    process.exit(1);
  }

  requireStatus(
    await call('POST', `/api/workflows/${workflowId}/publish`, {
      body: { changeSummary: 'load test seed' },
      token,
      workspaceId,
    }),
    201,
    'publish workflow',
  );

  const apiKey = requireStatus(
    await call('POST', '/api/v1/keys', {
      body: { name: 'load-test', permissions: ['WORKFLOW_EXECUTE'] },
      token,
      workspaceId,
    }),
    201,
    'create api key',
  );
  const keyView = apiKey.key as Record<string, unknown> | undefined;
  const apiKeyId = typeof keyView?.id === 'string' ? keyView.id : '';
  const rawKey = typeof apiKey.rawKey === 'string' ? apiKey.rawKey : '';
  if (!apiKeyId || !rawKey) {
    console.error('API key response did not include a key id and rawKey');
    process.exit(1);
  }

  await bumpRateLimits(apiKeyId, token, workspaceId);

  const output = {
    email,
    password,
    token,
    workspaceId,
    workflowId,
    apiKey: rawKey,
    apiKeyId,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(directory, 'seed-output.json'), JSON.stringify(output, null, 2));
  console.log(
    `Seed complete: workspace=${workspaceId} workflow=${workflowId} key=${apiKeyId} -> tests/load/seed-output.json`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});