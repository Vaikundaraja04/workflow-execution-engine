import { requireEnv, runLoadTest } from './runner.mjs';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const token = requireEnv('TOKEN');
const workspaceId = requireEnv('WORKSPACE_ID');

await runLoadTest({
  name: 'governance-evaluation',
  target: `POST ${baseUrl}/api/v1/ai/governance/router/route`,
  concurrency: 50,
  durationSeconds: 30,
  request: () => fetch(`${baseUrl}/api/v1/ai/governance/router/route`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-workspace-id': workspaceId,
    },
    body: JSON.stringify({
      prompt: 'Draft a deployment workflow for the payments service',
      feature: 'workflow_generation',
    }),
  }),
});
