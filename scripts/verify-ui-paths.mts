// Verifies the exact API paths the frontend dashboard calls.
const base = 'http://localhost:3000';
const email = 'demo@workflow.test';
const password = 'DemoPass123!';

async function jf(path: string, token: string, extra?: Record<string, string>) {
  const res = await fetch(base + path, {
    headers: { Authorization: `Bearer ${token}`, ...(extra ?? {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* raw */
  }
  return { status: res.status, body };
}

async function main() {
  const login = await (
    await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  ).json();
  const token: string = login.accessToken;
  const ws: string = login.defaultWorkspaceId;
  console.log('workspaceId =', ws);

  const wfs = await jf('/api/workflows', token, { 'X-Workspace-Id': ws });
  const list = (Array.isArray(wfs.body) ? wfs.body : []) as Array<Record<string, unknown>>;
  console.log('GET /api/workflows            ->', wfs.status, 'count=' + list.length);
  list.forEach((w) => console.log('     ' + String(w.name).padEnd(26) + ' ' + String(w.status)));

  for (const path of [
    `/api/analytics/workspaces/${ws}`,
    `/api/workspaces/${ws}/audit`,
    `/api/audit?workspaceId=${ws}`,
  ]) {
    const r = await jf(path, token);
    const summary = JSON.stringify(r.body).slice(0, 160);
    console.log('GET ' + path.padEnd(46) + '->', r.status, summary);
  }

  for (const w of list) {
    const id = String(w._id);
    const ex = await jf(`/api/workflows/${id}/executions`, token);
    const n = Array.isArray(ex.body) ? ex.body.length : '-';
    const dl = await jf(`/api/workflows/${id}/dead-letters`, token);
    const dln = Array.isArray(dl.body) ? dl.body.length : '-';
    console.log(
      'GET /api/workflows/' + id + '  [' + String(w.name) + ']  executions=' + n + ' deadLetters=' + dln + ' (' + ex.status + '/' + dl.status + ')',
    );
  }
}

await main();
