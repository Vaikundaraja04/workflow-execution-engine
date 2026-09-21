import { requireEnv, runLoadTest } from './runner.mjs';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const email = requireEnv('LOAD_EMAIL');
const password = requireEnv('LOAD_PASSWORD');

await runLoadTest({
  name: 'auth-login',
  target: `POST ${baseUrl}/api/auth/login`,
  concurrency: 25,
  durationSeconds: 30,
  request: () => fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }),
});
