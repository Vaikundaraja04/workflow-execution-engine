import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  createDisasterRecoverySnapshot,
  validateDisasterRecoverySnapshot,
} from './disasterRecoveryService.js';
import { securityAuditService } from './securityAuditService.js';
import { getIndexVerificationReport } from './databaseOptimizationService.js';
import { createAuditLog } from './auditService.js';

export interface ManifestCheck {
  file: string;
  present: boolean;
  missing: string[];
  ok: boolean;
}

export interface DeploymentValidationReport {
  generatedAt: string;
  manifestDirectory: string;
  files: ManifestCheck[];
  queueWorkerChecks: Array<{ id: string; ok: boolean; details: string }>;
  score: number;
  verdict: 'READY' | 'NOT_READY';
}

export interface DisasterRecoveryReadiness {
  generatedAt: string;
  backupStatus: {
    status: 'VALID' | 'INVALID';
    createdAt: string;
    checksum: string;
    counts: Record<string, number>;
  };
  restoreTest: {
    valid: boolean;
    checksumValid: boolean;
    countsMatch: boolean;
    errors: string[];
  };
  recoveryTimeEstimate: {
    measuredBackupMs: number;
    estimatedRecoveryMs: number;
    assumedRestoreFactor: number;
    rtoTargetMs: number;
    rpoTargetMs: number;
    meetsRto: boolean;
  };
  dataIntegrity: {
    checksumValid: boolean;
    countsMatch: boolean;
    totalRecords: number;
  };
}

const MANIFEST_DIRECTORY = path.join('deploy', 'k8s', 'production');
const MANIFEST_REQUIREMENTS: Array<{ file: string; required: string[] }> = [
  {
    file: 'api-deployment.yaml',
    required: [
      'kind: Deployment',
      'requests:',
      'limits:',
      'livenessProbe:',
      'readinessProbe:',
      'RollingUpdate',
      'securityContext',
      'secretKeyRef',
      'terminationGracePeriodSeconds',
      'readOnlyRootFilesystem',
    ],
  },
  {
    file: 'worker-deployment.yaml',
    required: [
      'kind: Deployment',
      'requests:',
      'limits:',
      'livenessProbe:',
      'RollingUpdate',
      'securityContext',
      'secretKeyRef',
      'terminationGracePeriodSeconds',
    ],
  },
  { file: 'hpa.yaml', required: ['kind: HorizontalPodAutoscaler', 'maxReplicas', 'averageUtilization'] },
  { file: 'pdb.yaml', required: ['kind: PodDisruptionBudget', 'minAvailable'] },
  { file: 'service.yaml', required: ['kind: Service', 'targetPort'] },
  { file: 'ingress.yaml', required: ['kind: Ingress', 'tls:', 'secretName'] },
  { file: 'secrets.example.yaml', required: ['kind: Secret', 'auth-jwt-secret', 'webhook-secret-key'] },
  { file: 'kustomization.yaml', required: ['resources:', 'api-deployment.yaml'] },
];

const QUEUE_WORKER_SOURCES: Array<{ file: string; required: string[]; details: string }> = [
  {
    file: path.join('src', 'queues', 'bullMqExecutionQueue.ts'),
    required: ['backoff', 'removeOnComplete', 'removeOnFail'],
    details: 'Queue retry backoff and bounded retention configured',
  },
  {
    file: path.join('src', 'observability', 'workerHeartbeat.ts'),
    required: ['heartbeat'],
    details: 'Worker heartbeat module present',
  },
  {
    file: path.join('src', 'workers', 'startWorker.ts'),
    required: ['SIGTERM', 'recoverPendingExecutions'],
    details: 'Graceful shutdown and pending execution recovery wired',
  },
];
export class ReleaseReadinessService {
  private static instance: ReleaseReadinessService;
  public static getInstance(): ReleaseReadinessService {
    if (!ReleaseReadinessService.instance) ReleaseReadinessService.instance = new ReleaseReadinessService();
    return ReleaseReadinessService.instance;
  }

  private readRepoFile(relativePath: string): string | null {
    const absolute = path.resolve(process.cwd(), relativePath);
    if (!existsSync(absolute)) return null;
    try {
      return readFileSync(absolute, 'utf8');
    } catch {
      return null;
    }
  }

  private checkQueueAndWorker(): Array<{ id: string; ok: boolean; details: string }> {
    return QUEUE_WORKER_SOURCES.map((source) => {
      const content = this.readRepoFile(source.file);
      if (content === null) {
        return { id: source.file, ok: false, details: `Source not found: ${source.file}` };
      }
      const missing = source.required.filter((token) => !content.includes(token));
      return {
        id: source.file,
        ok: missing.length === 0,
        details: missing.length === 0 ? source.details : `Missing: ${missing.join(', ')}`,
      };
    });
  }
  validateDeployment(): DeploymentValidationReport {
    const files: ManifestCheck[] = MANIFEST_REQUIREMENTS.map((requirement) => {
      const content = this.readRepoFile(path.join(MANIFEST_DIRECTORY, requirement.file));
      if (content === null) {
        return { file: requirement.file, present: false, missing: requirement.required, ok: false };
      }
      const missing = requirement.required.filter((token) => !content.includes(token));
      return { file: requirement.file, present: true, missing, ok: missing.length === 0 };
    });

    const queueWorkerChecks = this.checkQueueAndWorker();
    const failedFiles = files.filter((entry) => !entry.ok).length;
    const failedChecks = queueWorkerChecks.filter((entry) => !entry.ok).length;
    const score = Math.max(0, 100 - failedFiles * 12 - failedChecks * 10);
    const report: DeploymentValidationReport = {
      generatedAt: new Date().toISOString(),
      manifestDirectory: MANIFEST_DIRECTORY,
      files,
      queueWorkerChecks,
      score,
      verdict: failedFiles === 0 && failedChecks === 0 ? 'READY' : 'NOT_READY',
    };
    return report;
  }
  async validateDisasterRecovery(workspaceId: string, actorUserId?: string): Promise<DisasterRecoveryReadiness> {
    const startedAt = Date.now();
    const snapshot = await createDisasterRecoverySnapshot({
      workspaceId,
      ...(actorUserId ? { actorUserId } : {}),
    });
    const measuredBackupMs = Date.now() - startedAt;
    const validation = validateDisasterRecoverySnapshot(snapshot);

    const counts = snapshot.counts as unknown as Record<string, number>;
    const totalRecords = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const assumedRestoreFactor = 2;
    const estimatedRecoveryMs = measuredBackupMs * assumedRestoreFactor;
    const rtoTargetMs = 4 * 60 * 60 * 1000;
    const rpoTargetMs = 24 * 60 * 60 * 1000;

    const readiness: DisasterRecoveryReadiness = {
      generatedAt: new Date().toISOString(),
      backupStatus: {
        status: validation.valid ? 'VALID' : 'INVALID',
        createdAt: snapshot.createdAt,
        checksum: snapshot.checksum,
        counts,
      },
      restoreTest: {
        valid: validation.valid,
        checksumValid: validation.checksumValid,
        countsMatch: validation.countsMatch,
        errors: validation.errors,
      },
      recoveryTimeEstimate: {
        measuredBackupMs,
        estimatedRecoveryMs,
        assumedRestoreFactor,
        rtoTargetMs,
        rpoTargetMs,
        meetsRto: estimatedRecoveryMs <= rtoTargetMs,
      },
      dataIntegrity: {
        checksumValid: validation.checksumValid,
        countsMatch: validation.countsMatch,
        totalRecords,
      },
    };

    await createAuditLog({
      action: 'BACKUP_VALIDATED',
      ...(actorUserId ? { userId: actorUserId } : {}),
      workspaceId,
      resource: 'system',
      metadata: { status: readiness.backupStatus.status, totalRecords },
    });
    await createAuditLog({
      action: 'DR_TEST_COMPLETED',
      ...(actorUserId ? { userId: actorUserId } : {}),
      workspaceId,
      resource: 'system',
      metadata: {
        valid: validation.valid,
        estimatedRecoveryMs,
        meetsRto: readiness.recoveryTimeEstimate.meetsRto,
      },
    });

    return readiness;
  }
  async getReadinessReport(actorUserId?: string): Promise<{
    generatedAt: string;
    score: number;
    verdict: 'READY' | 'NEEDS_ATTENTION' | 'NOT_READY';
    dimensions: {
      security: { score: number; failures: number; warnings: number };
      database: { score: number; verdict: string; recommendations: number };
      deployment: { score: number; verdict: string };
      queueWorker: { score: number; checks: number; passing: number };
    };
    deployment: DeploymentValidationReport;
  }> {
    const [security, database] = await Promise.all([
      securityAuditService.runSecurityAudit(actorUserId),
      getIndexVerificationReport(),
    ]);
    const deployment = this.validateDeployment();
    const queuePassing = deployment.queueWorkerChecks.filter((check) => check.ok).length;
    const queueChecks = deployment.queueWorkerChecks.length;
    const queueScore = queueChecks > 0 ? Math.round((queuePassing / queueChecks) * 100) : 100;

    const score = Math.round(
      security.score * 0.4 + database.score * 0.25 + deployment.score * 0.25 + queueScore * 0.1,
    );
    const verdict = score >= 85 ? 'READY' : score >= 70 ? 'NEEDS_ATTENTION' : 'NOT_READY';

    await createAuditLog({
      action: 'DEPLOYMENT_READINESS_CHECKED',
      ...(actorUserId ? { userId: actorUserId } : {}),
      resource: 'system',
      metadata: { score, verdict, securityFailures: security.summary.failures },
    });

    return {
      generatedAt: new Date().toISOString(),
      score,
      verdict,
      dimensions: {
        security: { score: security.score, failures: security.summary.failures, warnings: security.summary.warnings },
        database: { score: database.score, verdict: database.verdict, recommendations: database.recommendations.length },
        deployment: { score: deployment.score, verdict: deployment.verdict },
        queueWorker: { score: queueScore, checks: queueChecks, passing: queuePassing },
      },
      deployment,
    };
  }
}

export const releaseReadinessService = ReleaseReadinessService.getInstance();
export default releaseReadinessService;