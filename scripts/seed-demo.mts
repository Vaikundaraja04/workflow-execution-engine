// Seeds a demo account with real, executable workflows so the UI has content.
// Only uses node types accepted by the engine schema: webhook | condition | log | agent.
//
// Usage:  npx tsx scripts/seed-demo.mts   (set API_URL to target a deployed API)
// Login:  demo@workflow.test / DemoPass123!
import { randomUUID } from 'node:crypto';

const base = process.env.API_URL ?? 'http://localhost:3000';
const EMAIL = 'demo@workflow.test';
const PASSWORD = 'DemoPass123!';

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
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  return { status: res.status, body: parsed as Json, raw: text };
}

function def(
  nodes: Array<{ id: string; type: string; config: Json }>,
  edges: Array<{ source: string; target: string; condition?: string }>,
) {
  return { nodes, edges };
}

const WORKFLOWS = [
  {
    name: 'Order Approval Router',
    definition: def(
      [
        { id: 'start', type: 'webhook', config: {} },
        { id: 'check', type: 'condition', config: { field: 'amount', operator: 'greaterThan', value: 500 } },
        { id: 'escalate', type: 'log', config: { message: 'Escalated to manager: order over 500' } },
        { id: 'approve', type: 'log', config: { message: 'Auto-approved: order under 500' } },
      ],
      [
        { source: 'start', target: 'check' },
        { source: 'check', target: 'escalate', condition: 'true' },
        { source: 'check', target: 'approve', condition: 'false' },
      ],
    ),
    publish: true,
    runs: [{ amount: 250 }, { amount: 1200 }, { amount: 75 }],
  },
  {
    name: 'Lead Intake Pipeline',
    definition: def(
      [
        { id: 'start', type: 'webhook', config: {} },
        { id: 'qualify', type: 'condition', config: { field: 'score', operator: 'greaterThan', value: 70 } },
        { id: 'hot', type: 'log', config: { message: 'Hot lead routed to sales team' } },
        { id: 'nurture', type: 'log', config: { message: 'Lead added to nurture campaign' } },
      ],
      [
        { source: 'start', target: 'qualify' },
        { source: 'qualify', target: 'hot', condition: 'true' },
        { source: 'qualify', target: 'nurture', condition: 'false' },
      ],
    ),
    publish: true,
    runs: [{ score: 88 }, { score: 42 }],
  },
  {
    name: 'Payment Validation Guard',
    definition: def(
      [
        { id: 'start', type: 'webhook', config: {} },
        { id: 'validate', type: 'condition', config: { field: 'amount', operator: 'greaterThan', value: 0 } },
        { id: 'accept', type: 'log', config: { message: 'Payment accepted' } },
      ],
      [
        { source: 'start', target: 'validate' },
        { source: 'validate', target: 'accept', condition: 'true' },
      ],
    ),
    publish: true,
    runs: [{ amount: 1000 }, { amount: 'not-a-number' }],
  },
  {
    name: 'Nightly Report Digest',
    definition: def(
      [
        { id: 'start', type: 'webhook', config: {} },
        { id: 'build', type: 'log', config: { message: 'Building nightly digest' } },
        { id: 'send', type: 'log', config: { message: 'Digest emailed to workspace admins' } },
      ],
      [
        { source: 'start', target: 'build' },
        { source: 'build', target: 'send' },
      ],
    ),
    publish: false,
    runs: [] as Json[],
  },
];


const TERMINAL = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'DEAD_LETTERED'];

async function waitFor(executionId: string, token: string): Promise<Json> {
  for (let i = 1; i <= 30; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await call('GET', `/api/executions/${executionId}`, undefined, token);
    const status = (poll.body as Json).status as string;
    if (TERMINAL.includes(status)) return poll.body as Json;
  }
  return { status: 'TIMEOUT_POLLING' };
}

async function main() {
  console.log('=== DEMO SEED ===');

  // 1. Login, or register if the demo user does not exist yet.
  let auth = await call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
  if (auth.status !== 200) {
    const reg = await call('POST', '/api/auth/register', { email: EMAIL, password: PASSWORD });
    console.log(`registered demo user (${reg.status})`);
    auth = await call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
  } else {
    console.log('demo user already existed, logged in');
  }
  const token = (auth.body as Json).accessToken as string | undefined;
  if (auth.status !== 200 || !token) {
    console.error('AUTH FAILED', auth.status, auth.raw);
    process.exitCode = 1;
    return;
  }

  const created: Array<{ name: string; published: boolean; statuses: string[] }> = [];

  for (const wf of WORKFLOWS) {
    const res = await call('POST', '/api/workflows', { name: wf.name, definition: wf.definition }, token);
    const id = (res.body as Json)._id as string | undefined;
    if (!id) {
      console.error(`create failed for "${wf.name}": ${res.status} ${res.raw}`);
      continue;
    }

    if (wf.publish) {
      const pub = await call('POST', `/api/workflows/${id}/publish`, { changeSummary: 'seeded demo version' }, token);
      if (pub.status !== 201) console.error(`publish failed for "${wf.name}": ${pub.status} ${pub.raw}`);
    }

    const statuses: string[] = [];
    for (const input of wf.runs) {
      const ex = await call(
        'POST',
        `/api/workflows/${id}/executions`,
        { input, idempotencyKey: randomUUID() },
        token,
      );
      const execId = (ex.body as Json).executionId as string | undefined;
      if (!execId) {
        console.error(`execute failed for "${wf.name}": ${ex.status} ${ex.raw}`);
        continue;
      }
      const final = await waitFor(execId, token);
      statuses.push(String(final.status));
    }

    created.push({ name: wf.name, published: wf.publish, statuses });
    console.log(`  ${wf.publish ? 'published' : 'draft    '}  ${wf.name.padEnd(26)} runs=[${statuses.join(', ')}]`);
  }

  const totalSeeded = created.reduce((n, c) => n + c.statuses.length, 0);
  console.log(`\nworkflows created: ${created.length}`);
  console.log(`executions seeded: ${totalSeeded}`);
  console.log(`\nLOGIN WITH:  ${EMAIL}  /  ${PASSWORD}`);
  console.log('OPEN:        http://localhost:3001/login');
}

await main();
