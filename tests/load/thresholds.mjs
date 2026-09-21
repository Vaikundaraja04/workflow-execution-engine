// Phase 12.10 - shared load-test thresholds enforced by tests/load/run-all.mjs.
// Keep in sync with tests/load/README.md and .github/workflows/load-test.yml.

export const THRESHOLDS = {
  'workflow-executions': { p95Ms: 750, errorRatePercent: 1, maxQueueDepth: 500 },
  'marketplace-search': { p95Ms: 400, errorRatePercent: 1 },
  'governance-evaluation': { p95Ms: 500, errorRatePercent: 1 },
  'auth-login': { p95Ms: 600, errorRatePercent: 1 },
};

export function evaluateSummary(name, summary, extra = {}) {
  const threshold = THRESHOLDS[name];
  if (!threshold) {
    return { ok: false, breaches: [`unknown scenario: ${name}`] };
  }
  const breaches = [];
  if (summary.latencyMs.p95 > threshold.p95Ms) {
    breaches.push(`p95 ${summary.latencyMs.p95}ms exceeds ${threshold.p95Ms}ms`);
  }
  if (summary.errorRatePercent >= threshold.errorRatePercent) {
    breaches.push(`error rate ${summary.errorRatePercent}% is not below ${threshold.errorRatePercent}%`);
  }
  if (
    threshold.maxQueueDepth !== undefined &&
    typeof extra.queueDepth === 'number' &&
    extra.queueDepth > threshold.maxQueueDepth
  ) {
    breaches.push(`final queue depth ${extra.queueDepth} exceeds ${threshold.maxQueueDepth}`);
  }
  return { ok: breaches.length === 0, breaches };
}