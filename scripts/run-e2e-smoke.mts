// End-to-end smoke run against the live API: register/login, create workflow,
// publish it, execute it, and poll until the worker finishes.
import { randomUUID } from 'node:crypto';

const base = 'http://localhost:3000';
const email = `e2e.${Date.now()}@local.test`;
const password = 'Password123!';

type Json = Record<string, unknown>;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Json | Json[] | string = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body: parsed, raw: text };
}

function log(label: string, value: unknown) {
  console.log(`\n=== ${label} ===`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

async function main() {
  // 1. Register a fresh user (creates a default workspace)
  const register = await call('POST', '/api/auth/register', { email, password });
  log(`REGISTER (${register.status})`, register.body);

  // 2. Login
  const login = await call('POST', '/api/auth/login', { email, password });
  const token = (login.body as Json).accessToken as string | undefined;
  log(`LOGIN (${login.status})`, token ? 'access token acquired' : login.body);
  if (!token) throw new Error('login failed');

  // 3. Create a workflow: webhook -> condition -> log(true) / log(false)
  const definition = {
    nodes: [
      { id: 'start', type: 'webhook', config: {} },
      {
        id: 'check',
        type: 'condition',
        config: { field: 'amount', operator: 'greaterThan', value: 100 },
      },
      { id: 'big', type: 'log', config: { message: 'Amount is large' } },
      { id: 'small', type: 'log', config: { message: 'Amount is small' } },
    ],
    edges: [
      { source: 'start', target: 'check' },
      { source: 'check', target: 'big', condition: 'true' },
      { source: 'check', target: 'small', condition: 'false' },
    ],
  };
  const created = await call(
    'POST',
    '/api/workflows',
    { name: 'E2E Smoke Workflow', definition },
    token,
  );
  const workflowId = (created.body as Json)._id as string | undefined;
  log(`CREATE WORKFLOW (${created.status})`, { workflowId, name: 'E2E Smoke Workflow' });
  if (!workflowId) throw new Error('workflow create failed');

  // 4. Publish
  const published = await call(
    'POST',
    `/api/workflows/${workflowId}/publish`,
    { changeSummary: 'initial e2e publish' },
    token,
  );
  log(`PUBLISH (${published.status})`, published.body);

  // 5. Execute with input that takes the "true" branch
  const executed = await call(
    'POST',
    `/api/workflows/${workflowId}/executions`,
    { input: { amount: 250 }, idempotencyKey: randomUUID() },
    token,
  );
  const executionId = (executed.body as Json).executionId as string | undefined;
  log(`EXECUTE (${executed.status})`, { executionId, status: (executed.body as Json).status });
  if (!executionId) throw new Error('execution create failed');

  // 6. Poll for completion
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'DEAD_LETTERED'];
  let final: Json = {};
  for (let attempt = 1; attempt <= 25; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const poll = await call('GET', `/api/executions/${executionId}`, undefined, token);
    final = poll.body as Json;
    const status = final.status as string;
    console.log(`poll ${attempt}: status=${status}`);
    if (terminal.includes(status)) break;
  }
  log('FINAL EXECUTION', final);

  // 7. Assertions
  const finalStatus = final.status as string;
  const stepStatuses = ((final.result as Json | undefined)?.stepStatuses ?? {}) as Record<string, string>;
  const outputs = ((final.result as Json | undefined)?.outputs ?? {}) as Record<string, Json>;

  const checks: Array<[string, boolean]> = [
    ['register returned 201', register.status === 201],
    ['login returned access token', login.status === 200],
    ['workflow created (201)', created.status === 201],
    ['workflow published (versionNumber=1)', published.status === 201 && (published.body as Json).versionNumber === 1],
    ['execution accepted (202 QUEUED)', executed.status === 202 && (executed.body as Json).status === 'QUEUED'],
    ['execution finished SUCCEEDED', finalStatus === 'SUCCEEDED'],
    ['start node SUCCEEDED', stepStatuses.start === 'SUCCEEDED'],
    ['check node SUCCEEDED', stepStatuses.check === 'SUCCEEDED'],
    ['true branch taken (big SUCCEEDED)', stepStatuses.big === 'SUCCEEDED'],
    ['false branch skipped (small SKIPPED)', stepStatuses.small === 'SKIPPED'],
    ['log node output captured', outputs.big?.message === 'Amount is large'],
  ];

  console.log('\n=== E2E ASSERTIONS ===');
  for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);

  // 8. List executions
  const list = await call('GET', `/api/workflows/${workflowId}/executions`, undefined, token);
  log(`LIST EXECUTIONS (${list.status})`, Array.isArray(list.body) ? `${(list.body as Json[]).length} record(s)` : list.body);

  const failures = checks.filter(([, ok]) => !ok);
  console.log(`\n${failures.length === 0 ? 'E2E RESULT: ALL CHECKS PASSED' : `E2E RESULT: ${failures.length} CHECK(S) FAILED`}`);
  console.log(`workflowId=${workflowId} executionId=${executionId}`);
  if (failures.length > 0) process.exitCode = 1;
}

await main();
