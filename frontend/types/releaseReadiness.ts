export type SecurityFindingStatus = 'PASS' | 'WARN' | 'FAIL';
export type SecuritySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface SecurityFindingDTO {
  id: string;
  category: string;
  title: string;
  status: SecurityFindingStatus;
  severity: SecuritySeverity;
  details: string;
}

export interface SecurityAuditReportDTO {
  score: number;
  generatedAt: string;
  findings: SecurityFindingDTO[];
  severity: { critical: number; high: number; medium: number; low: number };
  summary: { total: number; passed: number; warnings: number; failures: number };
}

export type BenchmarkVerdict = 'PASS' | 'WARN' | 'FAIL';

export interface BenchmarkOperationDTO {
  id: string;
  label: string;
  iterations: number;
  medianMs: number;
  worstMs: number;
  thresholdMs: number;
  verdict: BenchmarkVerdict;
}

export interface PerformanceBenchmarkReportDTO {
  generatedAt: string;
  workspaceId: string;
  operations: BenchmarkOperationDTO[];
  score: number;
  verdict: BenchmarkVerdict;
  slowest: { id: string; medianMs: number } | null;
}

export interface IndexVerificationEntryDTO {
  collection: string;
  count: number;
  avgDocumentBytes: number | null;
  missingIndexes: string[];
  status: 'HEALTHY' | 'WARN' | 'FAIL';
  issues: string[];
}

export interface IndexVerificationReportDTO {
  generatedAt: string;
  collections: IndexVerificationEntryDTO[];
  recommendations: string[];
  score: number;
  verdict: 'HEALTHY' | 'WARN' | 'FAIL';
}

export interface DeploymentFileCheckDTO {
  file: string;
  present: boolean;
  missing: string[];
  ok: boolean;
}

export interface DeploymentValidationReportDTO {
  generatedAt: string;
  manifestDirectory: string;
  files: DeploymentFileCheckDTO[];
  queueWorkerChecks: Array<{ id: string; ok: boolean; details: string }>;
  score: number;
  verdict: 'READY' | 'NOT_READY';
}

export interface DisasterRecoveryReadinessDTO {
  generatedAt: string;
  backupStatus: {
    status: 'VALID' | 'INVALID';
    createdAt: string;
    checksum: string;
    counts: Record<string, number>;
  };
  restoreTest: { valid: boolean; checksumValid: boolean; countsMatch: boolean; errors: string[] };
  recoveryTimeEstimate: {
    measuredBackupMs: number;
    estimatedRecoveryMs: number;
    assumedRestoreFactor: number;
    rtoTargetMs: number;
    rpoTargetMs: number;
    meetsRto: boolean;
  };
  dataIntegrity: { checksumValid: boolean; countsMatch: boolean; totalRecords: number };
}

export interface EnterpriseMetricsReportDTO {
  generatedAt: string;
  workspaceId: string;
  windowHours: number;
  apiLatency: { executionP95Ms: number; throughputRpm: number; errorRatePercent: number };
  workflowThroughput: {
    executions: number;
    succeeded: number;
    failed: number;
    successRatePercent: number;
    executionsPerHour: number;
  };
  aiCost: {
    requests: number;
    tokensUsed: number;
    costEstimate: number;
    byFeature: Array<{ feature: string; requests: number; tokensUsed: number; costEstimate: number }>;
  };
  agentExecution: {
    totalRuns: number;
    byStatus: Record<string, number>;
    failureRatePercent: number;
    toolCalls: number;
    failedToolCalls: number;
    toolErrorRatePercent: number;
  };
  marketplaceActivity: {
    installsInWindow: number;
    activeInstalls: number;
    reviewsInWindow: number;
    averageRating: number | null;
    executionsInWindow: number;
  };
}

export interface ReadinessReportDTO {
  generatedAt: string;
  score: number;
  verdict: 'READY' | 'NEEDS_ATTENTION' | 'NOT_READY';
  dimensions: {
    security: { score: number; failures: number; warnings: number };
    database: { score: number; verdict: string; recommendations: number };
    deployment: { score: number; verdict: string };
    queueWorker: { score: number; checks: number; passing: number };
  };
  deployment: DeploymentValidationReportDTO;
}
