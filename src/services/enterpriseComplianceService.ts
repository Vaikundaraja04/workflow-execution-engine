import { Types } from 'mongoose';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { SecurityEventModel } from '../models/SecurityEventModel.js';
import { ApprovalRequestModel } from '../models/ApprovalRequestModel.js';
import {
  AIApprovalPolicyModel,
  AIFeaturePolicyModel,
  AIModelAccessPolicyModel,
  AIPrivacyPolicyModel,
  AIPromptPolicyModel,
  AIUsageLimitPolicyModel,
} from '../models/AIGovernancePolicyModel.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { createAuditLog } from './auditService.js';

/**
 * Phase 18.5 - Compliance center.
 *
 * The ongoing posture view next to the Phase 8 SOC2 / GDPR / ISO evidence
 * reports: what the platform actually recorded. Sections without evidence are
 * reported as UNKNOWN and their weight is named in the notes - a score is never
 * fabricated from an empty window.
 */

export const EXPECTED_AUDIT_ACTIONS: readonly string[] = [
  'WORKFLOW_CREATED',
  'EXECUTION_STARTED',
  'WORKSPACE_UPDATED',
  'WORKSPACE_MEMBER_INVITED',
  'WORKSPACE_MEMBER_ROLE_CHANGED',
  'TEMPLATE_INSTALLED',
  'SECRET_CREATED',
  'SECRET_ROTATED',
  'PRIVACY_EXPORT_REQUESTED',
  'PRIVACY_DELETE_REQUESTED',
  'AI_GOVERNANCE_POLICY_CREATED',
  'MARKETPLACE_PURCHASE_COMPLETED',
];

export const DATA_ACCESS_ACTIONS: readonly string[] = [
  'PRIVACY_EXPORT_REQUESTED',
  'PRIVACY_EXPORT_DOWNLOADED',
  'PRIVACY_DELETE_REQUESTED',
  'SECRET_ACCESSED',
  'SECRET_CREATED',
  'SECRET_ROTATED',
  'SECRET_DELETED',
  'WORKSPACE_MEMBER_REMOVED',
];

export const GOVERNANCE_DECISION_ACTIONS = [
  'AI_GOVERNANCE_ALLOWED',
  'AI_GOVERNANCE_DENIED',
  'AI_GOVERNANCE_APPROVAL_REQUIRED',
] as const;

export type ComplianceSectionStatus = 'OK' | 'WARN' | 'UNKNOWN';

export interface ComplianceSection {
  key: string;
  label: string;
  weight: number;
  score: number;
  status: ComplianceSectionStatus;
  findings: string[];
  evidence: Record<string, number>;
}

export interface ComplianceReport {
  workspaceId: string | null;
  window: { days: number; since: string; until: string };
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  sections: ComplianceSection[];
  notes: string[];
  generatedAt: string;
}

function gradeForScore(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 365;

export class EnterpriseComplianceService {
  /** Posture from recorded evidence for one workspace, or the platform. */
  async report(options: {
    workspaceId?: string | undefined;
    days?: number | undefined;
    actorUserId?: string | undefined;
  } = {}): Promise<ComplianceReport> {
    const days = Number.isFinite(options.days) && options.days && options.days > 0
      ? Math.min(MAX_DAYS, Math.floor(options.days))
      : 30;
    const until = new Date();
    const since = new Date(until.getTime() - days * DAY_MS);

    let workspaceIdObj: Types.ObjectId | null = null;
    if (options.workspaceId !== undefined) {
      if (!Types.ObjectId.isValid(options.workspaceId)) throw new Error('WORKSPACE_NOT_FOUND');
      workspaceIdObj = new Types.ObjectId(options.workspaceId);
      const exists = await WorkspaceModel.exists({ _id: workspaceIdObj });
      if (!exists) throw new Error('WORKSPACE_NOT_FOUND');
    }
    const scope: Record<string, unknown> = workspaceIdObj ? { workspaceId: workspaceIdObj } : {};
    const notes: string[] = [];

    // 1) Audit coverage against the critical control points.
    const [auditEntries, auditActions] = await Promise.all([
      AuditLogModel.countDocuments({ ...scope, createdAt: { $gte: since, $lte: until } }),
      AuditLogModel.distinct('action', { ...scope, createdAt: { $gte: since, $lte: until } }),
    ]);
    const recordedActions = new Set<string>(auditActions);
    const covered = EXPECTED_AUDIT_ACTIONS.filter((action) => recordedActions.has(action));
    const missing = EXPECTED_AUDIT_ACTIONS.filter((action) => !recordedActions.has(action));
    const auditSection: ComplianceSection = {
      key: 'auditCoverage',
      label: 'Audit coverage',
      weight: 30,
      score: auditEntries === 0 ? 0 : Math.round((covered.length / EXPECTED_AUDIT_ACTIONS.length) * 100),
      status: auditEntries === 0 ? 'UNKNOWN' : missing.length <= 6 ? 'OK' : 'WARN',
      findings: auditEntries === 0
        ? ['No audit entries recorded in this window']
        : missing.slice(0, 6).map((action) => `No ${action} recorded in this window`),
      evidence: {
        entries: auditEntries,
        distinctActions: auditActions.length,
        coveredActions: covered.length,
        expectedActions: EXPECTED_AUDIT_ACTIONS.length,
      },
    };
    if (auditEntries === 0) notes.push('No audit entries recorded in this window');
    // 2) Security controls from recorded security events.
    const securityQuery: Record<string, unknown> = { createdAt: { $gte: since, $lte: until } };
    if (workspaceIdObj) securityQuery.workspaceId = workspaceIdObj;
    const securityEvents = await SecurityEventModel.find(securityQuery).select('severity status').lean();
    const openHighSeverity = securityEvents.filter(
      (event) => (event.severity === 'CRITICAL' || event.severity === 'HIGH')
        && (event.status === 'OPEN' || event.status === 'INVESTIGATING'),
    ).length;
    const resolvedEvents = securityEvents.filter(
      (event) => event.status === 'RESOLVED' || event.status === 'FALSE_POSITIVE',
    ).length;
    const securitySection: ComplianceSection = {
      key: 'securityControls',
      label: 'Security controls',
      weight: 25,
      score: securityEvents.length === 0
        ? 0
        : Math.max(0, 100 - openHighSeverity * 20 - (securityEvents.length - resolvedEvents) * 5),
      status: securityEvents.length === 0 ? 'UNKNOWN' : openHighSeverity === 0 ? 'OK' : 'WARN',
      findings: securityEvents.length === 0
        ? ['No security events recorded in this window']
        : openHighSeverity > 0
          ? [`${openHighSeverity} high severity security event(s) open`]
          : ['No open high severity security events'],
      evidence: { events: securityEvents.length, openHighSeverity, resolved: resolvedEvents },
    };
    if (securityEvents.length === 0) notes.push('No security events recorded in this window');
    // 3) Data access trail.
    const dataAccessBuckets = await AuditLogModel.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          ...scope,
          action: { $in: [...DATA_ACCESS_ACTIONS] },
          createdAt: { $gte: since, $lte: until },
        },
      },
      { $group: { _id: '$action', count: { $sum: 1 } } },
    ]);
    const dataAccessEvidence: Record<string, number> = {};
    let dataAccessTotal = 0;
    for (const bucket of dataAccessBuckets) {
      dataAccessEvidence[bucket._id] = bucket.count;
      dataAccessTotal += bucket.count;
    }
    const dataAccessSection: ComplianceSection = {
      key: 'dataAccess',
      label: 'Data access',
      weight: 20,
      score: dataAccessTotal === 0 ? 0 : 100,
      status: dataAccessTotal === 0 ? 'UNKNOWN' : 'OK',
      findings: dataAccessTotal === 0
        ? ['No data access actions recorded in this window']
        : [],
      evidence: { actions: dataAccessTotal, ...dataAccessEvidence },
    };
    if (dataAccessTotal === 0) notes.push('No data access actions recorded in this window');
    // 4) AI governance: policies configured, decisions taken, approvals pending.
    const policyScope: Record<string, unknown> = workspaceIdObj ? { workspaceId: workspaceIdObj } : {};
    const approvalScope: Record<string, unknown> = workspaceIdObj
      ? { workspaceId: workspaceIdObj, status: 'PENDING' }
      : { status: 'PENDING' };
    const [
      featurePolicies,
      modelPolicies,
      promptPolicies,
      privacyPolicies,
      usagePolicies,
      approvalPolicies,
      decisions,
      pendingApprovals,
    ] = await Promise.all([
      AIFeaturePolicyModel.countDocuments(policyScope),
      AIModelAccessPolicyModel.countDocuments(policyScope),
      AIPromptPolicyModel.countDocuments(policyScope),
      AIPrivacyPolicyModel.countDocuments(policyScope),
      AIUsageLimitPolicyModel.countDocuments(policyScope),
      AIApprovalPolicyModel.countDocuments(policyScope),
      AuditLogModel.countDocuments({
        ...scope,
        action: { $in: [...GOVERNANCE_DECISION_ACTIONS] },
        createdAt: { $gte: since, $lte: until },
      }),
      ApprovalRequestModel.countDocuments(approvalScope),
    ]);
    const policyCount = featurePolicies + modelPolicies + promptPolicies + privacyPolicies + usagePolicies + approvalPolicies;
    const governanceHasEvidence = policyCount > 0 || decisions > 0;
    const governanceScore = governanceHasEvidence
      ? (policyCount > 0 ? 50 : 0) + (decisions > 0 ? 30 : 0) + (pendingApprovals === 0 ? 20 : 0)
      : 0;
    const governanceFindings: string[] = [];
    if (policyCount === 0) governanceFindings.push('No AI governance policies configured');
    if (decisions === 0) governanceFindings.push('No governed AI decisions recorded in this window');
    if (pendingApprovals > 0) governanceFindings.push(`${pendingApprovals} approval request(s) pending`);
    const governanceSection: ComplianceSection = {
      key: 'aiGovernance',
      label: 'AI governance',
      weight: 25,
      score: governanceScore,
      status: governanceHasEvidence ? (governanceScore >= 70 ? 'OK' : 'WARN') : 'UNKNOWN',
      findings: governanceFindings,
      evidence: { policies: policyCount, decisions, pendingApprovals },
    };
    if (!governanceHasEvidence) notes.push('No AI governance activity recorded in this window');
    // Aggregate: only sections with evidence carry their weight.
    const sections = [auditSection, securitySection, dataAccessSection, governanceSection];
    const scored = sections.filter((section) => section.status !== 'UNKNOWN');
    const unknown = sections.filter((section) => section.status === 'UNKNOWN');
    const excludedWeight = unknown.reduce((sum, section) => sum + section.weight, 0);
    const scoredWeight = scored.reduce((sum, section) => sum + section.weight, 0);
    const score = scoredWeight === 0
      ? 0
      : Math.round(scored.reduce((sum, section) => sum + section.score * section.weight, 0) / scoredWeight);
    if (excludedWeight > 0) {
      notes.push(`${excludedWeight} points of weight excluded: no evidence for ${unknown.map((section) => section.label).join(', ')}`);
    }

    await createAuditLog({
      action: 'COMPLIANCE_CENTER_VIEWED',
      ...(options.actorUserId !== undefined ? { userId: options.actorUserId } : {}),
      ...(workspaceIdObj ? { workspaceId: workspaceIdObj } : {}),
      resource: 'compliance_center',
      resourceId: options.workspaceId ?? 'platform',
      metadata: { days, score, grade: gradeForScore(score), sections: sections.map((section) => section.key) },
    });

    return {
      workspaceId: options.workspaceId ?? null,
      window: { days, since: since.toISOString(), until: until.toISOString() },
      score,
      grade: gradeForScore(score),
      sections,
      notes,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const enterpriseComplianceService = new EnterpriseComplianceService();