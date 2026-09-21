import { performance } from 'node:perf_hooks';

export function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index];
}
export async function runLoadTest(options) {
  const concurrency = envInt('CONCURRENCY', options.concurrency ?? 100);
  const durationMs = envInt('DURATION_SECONDS', options.durationSeconds ?? 30) * 1000;

  console.log(`Load test: ${options.name}`);
  console.log(`Target: ${options.target}`);
  console.log(`Concurrency: ${concurrency} | Duration: ${durationMs / 1000}s`);

  const latencies = [];
  const statuses = new Map();
  let errors = 0;
  const startedAt = Date.now();
  const deadline = startedAt + durationMs;

  async function worker() {
    while (Date.now() < deadline) {
      const started = performance.now();
      let status = 'NETWORK_ERROR';
      try {
        const response = await options.request();
        status = String(response.status);
        if (response.status >= 400) errors += 1;
      } catch {
        errors += 1;
      }
      latencies.push(performance.now() - started);
      statuses.set(status, (statuses.get(status) ?? 0) + 1);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const elapsedMs = Date.now() - startedAt;
  const sorted = [...latencies].sort((left, right) => left - right);
  const total = latencies.length;
  const summary = {
    name: options.name,
    target: options.target,
    concurrency,
    durationSeconds: Math.round(elapsedMs / 1000),
    totalRequests: total,
    requestsPerSecond: Math.round((total / elapsedMs) * 1000 * 10) / 10,
    errorRatePercent: total > 0 ? Math.round((errors / total) * 1000) / 10 : 0,
    latencyMs: {
      p50: Math.round(percentile(sorted, 0.5) * 10) / 10,
      p95: Math.round(percentile(sorted, 0.95) * 10) / 10,
      p99: Math.round(percentile(sorted, 0.99) * 10) / 10,
      max: Math.round((sorted[sorted.length - 1] ?? 0) * 10) / 10,
    },
    statuses: Object.fromEntries([...statuses.entries()].sort()),
  };

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}
