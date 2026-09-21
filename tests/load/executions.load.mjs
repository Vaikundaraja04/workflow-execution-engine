import { requireEnv, runLoadTest } from './runner.mjs';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const apiKey = requireEnv('API_KEY');
const workflowId = requireEnv('WORKFLOW_ID');
let sequence = 0;

await runLoadTest({
  name: 'workflow-executions',
  target: `POST ${baseUrl}/api/v1/workflows/${workflowId}/trigger`,
  concurrency: 100,
  durationSeconds: 60,
  request: () => {
    sequence += 1;
    return fetch(`${baseUrl}/api/v1/workflows/${workflowId}/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        input: { source: 'load-test', sequence },
        idempotencyKey: `load-${process.pid}-${sequence}`,
      }),
    });
  },
});
