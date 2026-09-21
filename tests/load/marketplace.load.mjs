import { requireEnv, runLoadTest } from './runner.mjs';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const token = requireEnv('TOKEN');
const workspaceId = requireEnv('WORKSPACE_ID');
const query = process.env.SEARCH_QUERY ?? 'automation';

await runLoadTest({
  name: 'marketplace-search',
  target: `GET ${baseUrl}/api/v1/agent-marketplace/search`,
  concurrency: 100,
  durationSeconds: 30,
  request: () => fetch(`${baseUrl}/api/v1/agent-marketplace/search?q=${encodeURIComponent(query)}&limit=20`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-workspace-id': workspaceId,
    },
  }),
});
