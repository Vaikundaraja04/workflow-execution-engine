// Phase 12.10 - CI production readiness gate.
// Validates the production k8s overlay, the queue/worker wiring and the static
// security families without requiring MongoDB or Redis.
// Usage: npx tsx scripts/ci/production-readiness-gate.ts
import mongoose from 'mongoose';
import { releaseReadinessService } from '../../src/services/releaseReadinessService.js';
import { securityAuditService } from '../../src/services/securityAuditService.js';
import type { SecurityCategory, SecurityFinding } from '../../src/services/securityAuditService.js';

mongoose.set('bufferCommands', false);

const STATIC_FAMILIES: readonly SecurityCategory[] = [
  'AUTHENTICATION',
  'RBAC',
  'DATA_ISOLATION',
  'AUDIT_COVERAGE',
];

function isStaticFinding(finding: SecurityFinding): boolean {
  return STATIC_FAMILIES.includes(finding.category) || finding.id === 'secrets.webhook-key';
}

async function main(): Promise<void> {
  const problems: string[] = [];

  console.log('Production readiness gate');
  console.log('=========================');

  const deployment = releaseReadinessService.validateDeployment();
  console.log(`\nDeployment manifests (${deployment.manifestDirectory})`);
  for (const file of deployment.files) {
    const detail = file.missing.length > 0 ? ` missing: ${file.missing.join(', ')}` : '';
    console.log(`  ${file.ok ? 'OK  ' : 'FAIL'} ${file.file}${detail}`);
    if (!file.ok) {
      problems.push(`manifest ${file.file} missing: ${file.missing.join(', ')}`);
    }
  }

  console.log('\nQueue and worker wiring');
  for (const check of deployment.queueWorkerChecks) {
    console.log(`  ${check.ok ? 'OK  ' : 'FAIL'} ${check.id} - ${check.details}`);
    if (!check.ok) {
      problems.push(`queue/worker check ${check.id}: ${check.details}`);
    }
  }
  if (deployment.verdict !== 'READY') {
    problems.push(`deployment verdict is ${deployment.verdict} (score ${deployment.score})`);
  }
  const audit = await securityAuditService.runSecurityAudit();
  console.log('\nStatic security families');
  for (const finding of audit.findings.filter(isStaticFinding)) {
    console.log(`  ${finding.status} ${finding.id} [${finding.category}] - ${finding.details}`);
    if (finding.status === 'FAIL') {
      problems.push(`security finding ${finding.id}: ${finding.details}`);
    }
  }

  console.log('');
  if (problems.length > 0) {
    console.log(`Result: FAILED (${problems.length} problem(s))`);
    for (const problem of problems) {
      console.log(`  - ${problem}`);
    }
    process.exit(1);
  }
  console.log('Result: PASS - production readiness gate satisfied');
  process.exit(0);
}

main().catch((error) => {
  console.error('Production readiness gate crashed:', error);
  process.exit(1);
});