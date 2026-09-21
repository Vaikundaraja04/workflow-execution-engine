// Phase 12.10 - sequential load-test driver with enforced thresholds.
// Usage: node tests/load/run-all.mjs   (run tests/load/seed.ts first for a full run)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateSummary } from './thresholds.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const resultsDir = path.join(directory, 'results');

const SCENARIOS = [
  { name: 'workflow-executions', script: 'executions.load.mjs', requires: ['API_KEY', 'WORKFLOW_ID'] },
  { name: 'marketplace-search', script: 'marketplace.load.mjs', requires: ['TOKEN', 'WORKSPACE_ID'] },
  { name: 'governance-evaluation', script: 'governance.load.mjs', requires: ['TOKEN', 'WORKSPACE_ID'] },
  { name: 'auth-login', script: 'auth.load.mjs', requires: ['LOAD_EMAIL', 'LOAD_PASSWORD'] },
];

function loadSeedOutput() {
  const seedPath = path.join(directory, 'seed-output.json');
  if (!existsSync(seedPath)) return {};
  try {
    const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
    return {
      LOAD_EMAIL: seed.email,
      LOAD_PASSWORD: seed.password,
      TOKEN: seed.token,
      WORKSPACE_ID: seed.workspaceId,
      API_KEY: seed.apiKey,
      WORKFLOW_ID: seed.workflowId,
    };
  } catch {
    return {};
  }
}

function runScenario(scenario, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(directory, scenario.script)], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

function parseSummary(output) {
  const marker = output.lastIndexOf('\n{\n');
  if (marker === -1) return null;
  try {
    return JSON.parse(output.slice(marker + 1));
  } catch {
    return null;
  }
}

async function readQueueDepth(env) {
  if (!env.TOKEN || !env.WORKSPACE_ID) return null;
  try {
    const response = await fetch(`${baseUrl}/api/v1/release-readiness/live`, {
      headers: {
        authorization: `Bearer ${env.TOKEN}`,
        'x-workspace-id': env.WORKSPACE_ID,
      },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const depth = payload?.data?.queue?.depth;
    return typeof depth === 'number' ? depth : null;
  } catch {
    return null;
  }
}

function printTable(results) {
  console.log('\nLoad threshold summary');
  console.log('======================');
  for (const row of results) {
    const detail = row.p95 === undefined ? '' : `p95=${row.p95}ms errors=${row.errorRate}% rps=${row.rps}`;
    console.log(`${row.status.padEnd(7)} ${row.name.padEnd(24)} ${detail}`);
    for (const breach of row.breaches) {
      console.log(`        - ${breach}`);
    }
  }
  const breached = results.filter((row) => row.status === 'FAIL');
  console.log(
    breached.length === 0
      ? '\nResult: PASS'
      : `\nResult: FAIL (${breached.length} scenario(s) breached thresholds)`,
  );
}

async function main() {
  const seedEnv = loadSeedOutput();
  const results = [];
  let failed = false;

  mkdirSync(resultsDir, { recursive: true });

  for (const scenario of SCENARIOS) {
    const missing = scenario.requires.filter((key) => !process.env[key] && !seedEnv[key]);
    if (missing.length > 0) {
      console.error(`Skipping ${scenario.name}: missing ${missing.join(', ')} (run tests/load/seed.ts first)`);
      results.push({ name: scenario.name, status: 'SKIPPED', breaches: [`missing env: ${missing.join(', ')}`] });
      continue;
    }

    const env = { ...seedEnv, BASE_URL: baseUrl };
    const { code, output } = await runScenario(scenario, env);
    const summary = parseSummary(output);
    if (code !== 0 || !summary) {
      failed = true;
      results.push({
        name: scenario.name,
        status: 'FAILED',
        breaches: [`scenario exited with code ${code} before printing a summary`],
      });
      continue;
    }

    const extra = {};
    if (scenario.name === 'workflow-executions') {
      const depth = await readQueueDepth(env);
      if (depth !== null) extra.queueDepth = depth;
    }

    const evaluation = evaluateSummary(scenario.name, summary, extra);
    writeFileSync(
      path.join(resultsDir, `${scenario.name}.json`),
      JSON.stringify({ summary, extra, ...evaluation }, null, 2),
    );
    if (!evaluation.ok) failed = true;
    results.push({
      name: scenario.name,
      status: evaluation.ok ? 'PASS' : 'FAIL',
      p95: summary.latencyMs.p95,
      errorRate: summary.errorRatePercent,
      rps: summary.requestsPerSecond,
      breaches: evaluation.breaches,
    });
  }

  printTable(results);
  writeFileSync(
    path.join(resultsDir, 'summary.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
  );
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});