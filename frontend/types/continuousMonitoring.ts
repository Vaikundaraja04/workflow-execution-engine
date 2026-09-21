export type MetricResolutionDTO = '1m' | '5m' | '1h';
export type ReadinessScanVerdictDTO = 'READY' | 'NEEDS_ATTENTION' | 'NOT_READY';
export type ProductionAlertTypeDTO =
  | 'READINESS_DROP'
  | 'SECURITY_REGRESSION'
  | 'QUEUE_OVERLOAD'
  | 'WORKER_FAILURE'
  | 'AI_COST_SPIKE';
export type ProductionAlertStatusDTO = 'OPEN' | 'ACKNOWLEDGED';
export type ProductionAlertSeverityDTO = 'WARNING' | 'CRITICAL';

export interface LiveMetricsDTO {
  timestamp: string;
  cpuPercent: number | null;
  memory: { rssMb: number; usedMb: number; totalMb: number; systemUsedPercent: number | null };
  redis: { status: 'up' | 'down' | 'skipped'; latencyMs: number };
  queue: {
    available: boolean;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
    depth: number;
  };
  worker: {
    available: boolean;
    heartbeatAgeMs: number | null;
    capacity: number;
    utilizationPercent: number | null;
  };
  websocket: { available: boolean; connections: number | null };
  api: { requests: number; p95Ms: number; errorRatePercent: number };
  executions: {
    lastHour: number;
    failedLastHour: number;
    throughputPerHour: number;
    errorRatePercent: number;
  };
}

export interface MetricsHistoryPointDTO {
  timestamp: string;
  cpuPercent: number | null;
  memoryUsedPercent: number | null;
  queueDepth: number;
  workerUtilizationPercent: number | null;
  executionsLastHour: number;
  executionErrorRatePercent: number;
  apiP95Ms: number;
  websocketConnections: number | null;
}

export interface MetricsHistoryDTO {
  resolution: MetricResolutionDTO;
  hours: number;
  points: MetricsHistoryPointDTO[];
}

export interface ReadinessScanMetricsDTO {
  redisStatus: 'up' | 'down' | 'skipped';
  queueDepth: number;
  workerAvailable: boolean;
  workerUtilizationPercent: number | null;
  apiP95Ms: number;
  executionsLastHour: number;
  executionErrorRatePercent: number;
}

export interface ReadinessScanDTO {
  id: string;
  workspaceId: string | null;
  score: number;
  previousScore: number | null;
  delta: number | null;
  verdict: ReadinessScanVerdictDTO;
  dimensions: {
    security: { score: number; failures: number; warnings: number };
    database: { score: number; verdict: string; recommendations: number };
    deployment: { score: number; verdict: string };
    queueWorker: { score: number; checks: number; passing: number };
  };
  metrics: ReadinessScanMetricsDTO;
  regressions: string[];
  createdAt: string;
  alerts: { created: string[]; updated: string[] } | null;
}

export interface ProductionAlertDTO {
  id: string;
  type: ProductionAlertTypeDTO;
  severity: ProductionAlertSeverityDTO;
  status: ProductionAlertStatusDTO;
  workspaceId: string | null;
  title: string;
  details: string;
  value: number | null;
  threshold: number | null;
  scanId: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
  updatedAt: string;
}