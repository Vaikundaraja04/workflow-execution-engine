import mongoose from 'mongoose';
import { AUDIT_ACTIONS } from '../models/AuditLogModel.js';
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  permissionsForRole,
  roleHasAgentMarketplacePermission,
} from '../auth/permissions.js';
import { APIKeyModel } from '../models/APIKeyModel.js';
import { WebhookModel } from '../models/WebhookModel.js';
import { AgentToolPolicyModel } from '../models/AgentToolPolicyModel.js';
import { AIGovernanceBudgetModel } from '../models/AIGovernanceBudgetModel.js';
import { AIModelAccessPolicyModel, AIUsageLimitPolicyModel } from '../models/AIGovernancePolicyModel.js';
import { AgentMarketplaceModel } from '../models/AgentMarketplaceModel.js';
import { InstalledAgentModel } from '../models/InstalledAgentModel.js';
import { AgentReviewModel } from '../models/AgentReviewModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { DANGEROUS_TOOLS_REQUIRING_APPROVAL } from './agent/agentToolInvocation.js';
import { createAuditLog } from './auditService.js';
import { AISecurityService } from './ai/aiSecurityService.js';

export type SecuritySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SecurityFindingStatus = 'PASS' | 'WARN' | 'FAIL';
export type SecurityCategory =
  | 'AUTHENTICATION'
  | 'API_KEYS'
  | 'RBAC'
  | 'AI_GOVERNANCE'
  | 'AGENT_TOOLS'
  | 'SECRETS'
  | 'DATA_ISOLATION'
  | 'AUDIT_COVERAGE';

export interface SecurityFinding {
  id: string;
  category: SecurityCategory;
  title: string;
  status: SecurityFindingStatus;
  severity: SecuritySeverity;
  details: string;
}

export interface SecurityAuditReport {
  score: number;
  generatedAt: string;
  findings: SecurityFinding[];
  severity: { critical: number; high: number; medium: number; low: number };
  summary: { total: number; passed: number; warnings: number; failures: number };
}

const SEVERITY_WEIGHT: Record<SecuritySeverity, number> = {
  CRITICAL: 20,
  HIGH: 10,
  MEDIUM: 5,
  LOW: 2,
};

export const SECURITY_SCORE_PENALTY: Record<SecuritySeverity, number> = SEVERITY_WEIGHT;
function ttlToMs(ttl: string): number | null {
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2];
  const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return value * factor;
}

const MINIMAL_VIEWER_PERMISSIONS: string[] = ['WORKFLOW_READ', 'AGENT_MARKETPLACE_READ'];

const REQUIRED_AUDIT_ACTIONS = [
  'AUTH_LOGIN_SUCCESS',
  'AI_GOVERNANCE_DENIED',
  'AGENT_LISTING_PUBLISHED',
  'SECURITY_AUDIT_COMPLETED',
];

function dbReady(): boolean {
  return mongoose.connection.readyState === 1;
}
export class SecurityAuditService {
  private static instance: SecurityAuditService;
  public static getInstance(): SecurityAuditService {
    if (!SecurityAuditService.instance) SecurityAuditService.instance = new SecurityAuditService();
    return SecurityAuditService.instance;
  }

  async runSecurityAudit(actorUserId?: string): Promise<SecurityAuditReport> {
    const findings: SecurityFinding[] = [];
    const push = (finding: SecurityFinding): void => {
      findings.push(finding);
    };

    await this.checkAuthentication(push);
    await this.checkApiKeys(push);
    this.checkRbac(push);
    await this.checkAiGovernance(push);
    await this.checkAgentTools(push);
    await this.checkSecrets(push);
    this.checkDataIsolation(push);
    this.checkAuditCoverage(push);

    const severity = { critical: 0, high: 0, medium: 0, low: 0 };
    let penalty = 0;
    for (const finding of findings) {
      if (finding.status === 'PASS') continue;
      const key = finding.severity.toLowerCase() as keyof typeof severity;
      severity[key] += 1;
      penalty += SEVERITY_WEIGHT[finding.severity] * (finding.status === 'WARN' ? 0.5 : 1);
    }

    const report: SecurityAuditReport = {
      score: Math.max(0, Math.round(100 - penalty)),
      generatedAt: new Date().toISOString(),
      findings,
      severity,
      summary: {
        total: findings.length,
        passed: findings.filter((item) => item.status === 'PASS').length,
        warnings: findings.filter((item) => item.status === 'WARN').length,
        failures: findings.filter((item) => item.status === 'FAIL').length,
      },
    };

    await createAuditLog({
      action: 'SECURITY_AUDIT_COMPLETED',
      ...(actorUserId ? { userId: actorUserId } : {}),
      resource: 'system',
      metadata: AISecurityService.sanitizeMetadata({
        score: report.score,
        failures: report.summary.failures,
        warnings: report.summary.warnings,
        critical: severity.critical,
        high: severity.high,
      }),
    });

    return report;
  }
  private async checkAuthentication(push: (finding: SecurityFinding) => void): Promise<void> {
    const secret = process.env.AUTH_JWT_SECRET ?? process.env.JWT_SECRET ?? '';
    push({
      id: 'auth.jwt-secret',
      category: 'AUTHENTICATION',
      title: 'JWT signing secret strength',
      status: secret.length >= 32 ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      details: secret.length >= 32
        ? 'Signing secret is at least 32 characters.'
        : 'Signing secret is missing or shorter than 32 characters.',
    });

    const accessTtl = process.env.AUTH_ACCESS_TTL ?? '15m';
    const accessMs = ttlToMs(accessTtl);
    push({
      id: 'auth.access-ttl',
      category: 'AUTHENTICATION',
      title: 'Access token lifetime bounded',
      status: accessMs !== null && accessMs <= 3_600_000 ? 'PASS' : 'WARN',
      severity: 'HIGH',
      details: `Access token TTL is ${accessTtl} (target <= 1h).`,
    });

    const refreshTtl = process.env.AUTH_REFRESH_TTL ?? '30d';
    const refreshMs = ttlToMs(refreshTtl);
    push({
      id: 'auth.refresh-ttl',
      category: 'AUTHENTICATION',
      title: 'Refresh token lifetime bounded',
      status: refreshMs !== null && refreshMs <= 45 * 86_400_000 ? 'PASS' : 'WARN',
      severity: 'MEDIUM',
      details: `Refresh token TTL is ${refreshTtl} (target <= 45d).`,
    });
  }
  private async checkApiKeys(push: (finding: SecurityFinding) => void): Promise<void> {
    if (!dbReady()) {
      push({
        id: 'apikeys.database',
        category: 'API_KEYS',
        title: 'API key inventory',
        status: 'WARN',
        severity: 'LOW',
        details: 'Database unavailable; API key inventory not evaluated.',
      });
      return;
    }

    const [withoutExpiry, staleUnused, revokedWithoutTimestamp] = await Promise.all([
      APIKeyModel.countDocuments({ status: 'ACTIVE', expiresAt: { $exists: false } }),
      APIKeyModel.countDocuments({
        status: 'ACTIVE',
        lastUsedAt: { $exists: false },
        createdAt: { $lte: new Date(Date.now() - 90 * 86_400_000) },
      }),
      APIKeyModel.countDocuments({ status: 'REVOKED', revokedAt: { $exists: false } }),
    ]);

    push({
      id: 'apikeys.expiry',
      category: 'API_KEYS',
      title: 'Active API keys have expiry',
      status: withoutExpiry === 0 ? 'PASS' : 'WARN',
      severity: 'MEDIUM',
      details: withoutExpiry === 0
        ? 'Every active API key declares an expiry.'
        : `${withoutExpiry} active key(s) never expire.`,
    });
    push({
      id: 'apikeys.stale',
      category: 'API_KEYS',
      title: 'Unused API keys rotated',
      status: staleUnused === 0 ? 'PASS' : 'WARN',
      severity: 'LOW',
      details: staleUnused === 0
        ? 'No active key has been idle for more than 90 days.'
        : `${staleUnused} active key(s) unused for more than 90 days.`,
    });
    push({
      id: 'apikeys.revocation',
      category: 'API_KEYS',
      title: 'Revoked keys are timestamped',
      status: revokedWithoutTimestamp === 0 ? 'PASS' : 'FAIL',
      severity: 'MEDIUM',
      details: `${revokedWithoutTimestamp} revoked key(s) missing revokedAt.`,
    });
  }
  private checkRbac(push: (finding: SecurityFinding) => void): void {
    const ownerComplete = PERMISSIONS.every((permission) => ROLE_PERMISSIONS.OWNER.includes(permission));
    const adminComplete = PERMISSIONS.every((permission) => ROLE_PERMISSIONS.ADMIN.includes(permission));
    push({
      id: 'rbac.owner-admin-complete',
      category: 'RBAC',
      title: 'OWNER and ADMIN hold every permission',
      status: ownerComplete && adminComplete ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: ownerComplete && adminComplete
        ? 'OWNER and ADMIN both hold the full permission set.'
        : 'OWNER or ADMIN is missing permissions.',
    });

    const viewerPermissions = permissionsForRole('VIEWER');
    const viewerMinimal = viewerPermissions.every((permission) =>
      MINIMAL_VIEWER_PERMISSIONS.includes(permission as string),
    );
    push({
      id: 'rbac.viewer-minimal',
      category: 'RBAC',
      title: 'VIEWER holds only read-only permissions',
      status: viewerMinimal ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `VIEWER permissions: ${viewerPermissions.join(', ') || 'none'}.`,
    });

    const editorCanInstall = roleHasAgentMarketplacePermission('EDITOR', 'AGENT_INSTALL');
    const editorCannotManage = !roleHasAgentMarketplacePermission('EDITOR', 'AGENT_MARKETPLACE_MANAGE');
    push({
      id: 'rbac.marketplace-editor',
      category: 'RBAC',
      title: 'Marketplace role mapping (editor read/install, no manage)',
      status: editorCanInstall && editorCannotManage ? 'PASS' : 'FAIL',
      severity: 'MEDIUM',
      details: `EDITOR install=${editorCanInstall}, manage=${!editorCannotManage}.`,
    });
  }
  private async checkAiGovernance(push: (finding: SecurityFinding) => void): Promise<void> {
    if (!dbReady()) {
      push({
        id: 'governance.database',
        category: 'AI_GOVERNANCE',
        title: 'AI governance policies',
        status: 'WARN',
        severity: 'LOW',
        details: 'Database unavailable; governance policies not evaluated.',
      });
      return;
    }

    const budgets = await AIGovernanceBudgetModel.find({}).lean();
    const invalidBudgets = budgets.filter(
      (budget) => budget.blockThreshold > 100 || budget.throttleThreshold > budget.blockThreshold,
    );
    push({
      id: 'governance.budget-thresholds',
      category: 'AI_GOVERNANCE',
      title: 'Budget thresholds ordered and bounded',
      status: invalidBudgets.length === 0 ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: invalidBudgets.length === 0
        ? `${budgets.length} budget configuration(s) verified.`
        : `${invalidBudgets.length} budget configuration(s) have out-of-order thresholds.`,
    });

    const disabledModelPolicies = await AIModelAccessPolicyModel.countDocuments({ status: 'DISABLED' });
    push({
      id: 'governance.model-policy-status',
      category: 'AI_GOVERNANCE',
      title: 'Model access policies active when configured',
      status: disabledModelPolicies === 0 ? 'PASS' : 'WARN',
      severity: 'MEDIUM',
      details: disabledModelPolicies === 0
        ? 'No disabled model access policy shadows an active configuration.'
        : `${disabledModelPolicies} model access policy(ies) are DISABLED.`,
    });

    const limitPolicies = await AIUsageLimitPolicyModel.countDocuments({});
    push({
      id: 'governance.usage-limits',
      category: 'AI_GOVERNANCE',
      title: 'Workspace usage limits configured',
      status: limitPolicies > 0 ? 'PASS' : 'WARN',
      severity: 'LOW',
      details: limitPolicies > 0
        ? `${limitPolicies} usage limit policy(ies) configured.`
        : 'No workspace AI usage limits configured yet (advisory).',
    });
  }
  private async checkAgentTools(push: (finding: SecurityFinding) => void): Promise<void> {
    if (!dbReady()) {
      push({
        id: 'tools.database',
        category: 'AGENT_TOOLS',
        title: 'Agent tool policies',
        status: 'WARN',
        severity: 'LOW',
        details: 'Database unavailable; agent tool policies not evaluated.',
      });
      return;
    }

    const dangerous = [...DANGEROUS_TOOLS_REQUIRING_APPROVAL];
    const blanketAllows = await AgentToolPolicyModel.find({
      toolName: { $in: dangerous },
      policy: 'ALLOW',
    }).lean();

    push({
      id: 'tools.dangerous-allows',
      category: 'AGENT_TOOLS',
      title: 'Dangerous tools require approval',
      status: blanketAllows.length === 0 ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: blanketAllows.length === 0
        ? `No workspace override allows a dangerous tool (${dangerous.join(', ')}).`
        : `${blanketAllows.length} override(s) allow dangerous tools: ${blanketAllows.map((entry) => entry.toolName).join(', ')}.`,
    });
  }
  private async checkSecrets(push: (finding: SecurityFinding) => void): Promise<void> {
    const isProduction = process.env.NODE_ENV === 'production';
    const webhookKey = process.env.WEBHOOK_SECRET_KEY;
    push({
      id: 'secrets.webhook-key',
      category: 'SECRETS',
      title: 'Webhook encryption key configured',
      status: webhookKey && webhookKey.length >= 32 ? 'PASS' : isProduction ? 'FAIL' : 'WARN',
      severity: 'HIGH',
      details: webhookKey && webhookKey.length >= 32
        ? 'Webhook encryption key is configured and long enough.'
        : 'WEBHOOK_SECRET_KEY is unset or too short; the service falls back to a built-in default key.',
    });

    if (dbReady()) {
      const webhooks = await WebhookModel.find({}).select('encryptedSecret').lean();
      const shortSecrets = webhooks.filter((hook) => (hook.encryptedSecret ?? '').length < 32).length;
      push({
        id: 'secrets.webhook-records',
        category: 'SECRETS',
        title: 'Stored webhook secrets are encrypted',
        status: shortSecrets === 0 ? 'PASS' : 'WARN',
        severity: 'MEDIUM',
        details: shortSecrets === 0
          ? `${webhooks.length} webhook secret(s) stored encrypted.`
          : `${shortSecrets} webhook record(s) have suspiciously short encrypted secrets.`,
      });
    }
  }
  private checkDataIsolation(push: (finding: SecurityFinding) => void): void {
    const models = [
      { name: 'AgentMarketplace', model: AgentMarketplaceModel },
      { name: 'InstalledAgent', model: InstalledAgentModel },
      { name: 'AgentReview', model: AgentReviewModel },
      { name: 'WorkflowExecution', model: WorkflowExecutionModel },
      { name: 'AuditLog', model: AuditLogModel },
    ];
    const missing = models
      .filter((entry) => !entry.model.schema.paths['workspaceId'])
      .map((entry) => entry.name);

    push({
      id: 'isolation.workspace-scoped',
      category: 'DATA_ISOLATION',
      title: 'Key collections are workspace scoped',
      status: missing.length === 0 ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      details: missing.length === 0
        ? `${models.length} collection(s) declare workspaceId.`
        : `Collections missing workspaceId: ${missing.join(', ')}.`,
    });
  }

  private checkAuditCoverage(push: (finding: SecurityFinding) => void): void {
    const missing = REQUIRED_AUDIT_ACTIONS.filter(
      (action) => !(AUDIT_ACTIONS as readonly string[]).includes(action),
    );
    push({
      id: 'audit.action-coverage',
      category: 'AUDIT_COVERAGE',
      title: 'Required audit actions registered',
      status: missing.length === 0 ? 'PASS' : 'FAIL',
      severity: 'MEDIUM',
      details: missing.length === 0
        ? `All ${REQUIRED_AUDIT_ACTIONS.length} required audit actions are registered.`
        : `Missing audit actions: ${missing.join(', ')}.`,
    });
  }
}

export const securityAuditService = SecurityAuditService.getInstance();
export default securityAuditService;