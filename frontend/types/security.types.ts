export interface SecurityDashboardData {
  riskScore: number;
  riskCategory: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  openThreatsCount: number;
  totalEvents24h: number;
  failedLogins24h: number;
  activeSessionsCount: number;
  recentEvents: SecurityEvent[];
}

export interface SecurityEvent {
  _id: string;
  workspaceId?: string;
  userId?: string;
  eventType: string;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'FALSE_POSITIVE';
  description: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  resolvedAt?: string;
  resolvedByUserId?: string;
  resolutionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RiskScoreData {
  overallScore: number;
  riskCategory: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  breakdown: {
    authentication: { score: number; weight: number; findings: string[] };
    accessControl: { score: number; weight: number; findings: string[] };
    dataProtection: { score: number; weight: number; findings: string[] };
    networkSecurity: { score: number; weight: number; findings: string[] };
  };
  recommendations: Array<{
    title: string;
    description: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    remediationAction: string;
  }>;
}

export interface SessionData {
  _id: string;
  userId: string;
  workspaceId?: string;
  ipAddress?: string;
  userAgent?: string;
  browser?: string;
  os?: string;
  deviceType?: string;
  isActive: boolean;
  lastActiveAt: string;
  expiresAt: string;
  isCurrent?: boolean;
  createdAt: string;
}

export interface WorkspaceSecurityPolicy {
  _id?: string;
  workspaceId: string;
  ipAllowlistEnabled: boolean;
  ipAllowlist: string[];
  enforceMfa: boolean;
  sessionTimeoutMinutes: number;
  maxConcurrentSessions: number;
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireNumbers: boolean;
  passwordRequireSymbols: boolean;
  passwordExpiryDays: number;
  passwordHistoryCount: number;
}

export interface SecretMetadata {
  _id: string;
  workspaceId: string;
  name: string;
  environment: 'development' | 'staging' | 'production';
  version: number;
  lastRotatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PrivacyRequest {
  _id: string;
  userId: string;
  workspaceId?: string;
  requestType: 'EXPORT' | 'DELETE';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'REJECTED' | 'EXPIRED';
  requestedAt: string;
  processedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
}

export interface PrivacyPreferences {
  analyticsConsent: boolean;
  marketingConsent: boolean;
  diagnosticsConsent: boolean;
  retentionPeriodMonths?: number;
  updatedAt?: string;
}

export interface AuditLogEntry {
  _id: string;
  action: string;
  userId?: string;
  workspaceId?: string;
  resource?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  prevHash?: string;
  recordHash?: string;
  signature?: string;
  createdAt: string;
}

export type ComplianceFramework = 'SOC2' | 'GDPR' | 'ISO27001';

export interface ComplianceControl {
  id: string;
  title: string;
  description?: string;
  compliant: boolean;
  evidence?: string[];
}

export interface ComplianceSection {
  title: string;
  description?: string;
  controls: ComplianceControl[];
}

export interface ComplianceReportData {
  id: string;
  framework: ComplianceFramework;
  generatedAt: string;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'FAILED';
  sections: ComplianceSection[];
  summary: string;
}

