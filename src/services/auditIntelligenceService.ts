import { Types } from 'mongoose';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { SecurityEventModel } from '../models/SecurityEventModel.js';
import { UserSessionModel } from '../models/UserSessionModel.js';
import { securityCenterService } from './securityCenterService.js';
import type { SecurityIntelligenceData } from '../types/operations.types.js';

export class AuditIntelligenceService {
  /**
   * Run full audit log intelligence scan & anomaly analysis
   */
  public static async getSecurityIntelligence(
    workspaceId: string
  ): Promise<SecurityIntelligenceData> {
    const wsId = new Types.ObjectId(workspaceId);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      riskScoreData,
      failedAuthLogs,
      suspiciousLogs,
      recentSecurityEvents,
      activeSessions,
    ] = await Promise.all([
      securityCenterService.getRiskScore(workspaceId),

      // Failed auth events
      AuditLogModel.find({
        workspaceId: wsId as any,
        action: {
          $in: [
            'AUTH_LOGIN_FAILED',
            'SSO_LOGIN_FAILED',
            'API_KEY_REVOKED',
          ] as any,
        },
        createdAt: { $gte: thirtyDaysAgo },
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),

      // Privilege escalations / high-risk activity
      AuditLogModel.find({
        workspaceId: wsId as any,
        action: {
          $in: [
            'WORKSPACE_MEMBER_ROLE_CHANGED',
            'SECURITY_POLICY_UPDATED',
            'WORKFLOW_DELETED',
            'SECRET_DELETED',
            'SECURITY_THREAT_DETECTED',
          ] as any,
        },
        createdAt: { $gte: sevenDaysAgo },
      })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),

      // Security Events
      SecurityEventModel.find({
        workspaceId: wsId as any,
        createdAt: { $gte: thirtyDaysAgo },
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),

      // Active sessions
      UserSessionModel.find({
        createdAt: { $gte: sevenDaysAgo },
      })
        .limit(50)
        .lean(),
    ]);

    // Anomaly score calculation
    let anomalyPoints = 0;
    const insights: SecurityIntelligenceData['insights'] = [];
    const suspiciousActivities: SecurityIntelligenceData['suspiciousActivities'] = [];

    // Check failed auth spikes
    const failedIps = new Set<string>();
    const targetedUsers = new Set<string>();
    const hourlyFailures = new Map<string, number>();

    for (const log of failedAuthLogs) {
      if (log.ipAddress) failedIps.add(log.ipAddress);
      if (log.userId) targetedUsers.add(log.userId.toString());
      const dateHour = log.createdAt.toISOString().slice(0, 13) + ':00';
      hourlyFailures.set(dateHour, (hourlyFailures.get(dateHour) || 0) + 1);
    }

    if (failedAuthLogs.length > 20) {
      anomalyPoints += 25;
      insights.push({
        id: 'INS-01',
        type: 'AUTH_BURST',
        severity: failedAuthLogs.length > 50 ? 'HIGH' : 'MEDIUM',
        title: 'Elevated Failed Login Volume',
        description: `Detected ${failedAuthLogs.length} failed authentication attempts across ${failedIps.size} distinct IP addresses.`,
        detectedAt: new Date().toISOString(),
        recommendation: 'Enable IP allowlisting and enforce multi-factor authentication (MFA).',
      });
    }

    // Analyze suspicious actions
    for (const log of suspiciousLogs) {
      const item: SecurityIntelligenceData['suspiciousActivities'][0] = {
        id: log._id.toString(),
        action: log.action,
        actor: log.userId ? log.userId.toString() : 'system',
        reason: `High privilege action executed: ${log.action}`,
        timestamp: log.createdAt.toISOString(),
      };
      if (log.ipAddress) {
        item.ipAddress = log.ipAddress;
      }
      suspiciousActivities.push(item);
    }

    if (suspiciousLogs.length > 10) {
      anomalyPoints += 20;
      insights.push({
        id: 'INS-02',
        type: 'PRIVILEGE_ACTION_BURST',
        severity: 'HIGH',
        title: 'Cluster of Sensitive Actions Detected',
        description: `${suspiciousLogs.length} sensitive modifications (role changes, secret removals, key revocations) occurred within the past 7 days.`,
        detectedAt: new Date().toISOString(),
        recommendation: 'Review audit logs and verify authorization for recent administrative alterations.',
      });
    }

    // Geolocation / Concurrent IP analysis on sessions
    const ipSessionMap = new Map<string, string[]>();
    for (const session of activeSessions) {
      if (session.ipAddress && session.userId) {
        const list = ipSessionMap.get(session.userId.toString()) || [];
        list.push(session.ipAddress);
        ipSessionMap.set(session.userId.toString(), list);
      }
    }

    let multiIpUsers = 0;
    for (const [_user, ips] of ipSessionMap.entries()) {
      const uniqueIps = new Set(ips);
      if (uniqueIps.size > 2) {
        multiIpUsers++;
      }
    }

    if (multiIpUsers > 0) {
      anomalyPoints += 15;
      insights.push({
        id: 'INS-03',
        type: 'GEOGRAPHIC_ANOMALY',
        severity: 'MEDIUM',
        title: 'Concurrent Logins from Multiple Remote IPs',
        description: `${multiIpUsers} user accounts exhibited active sessions spanning multiple distinct IP addresses.`,
        detectedAt: new Date().toISOString(),
        recommendation: 'Review active user sessions and terminate suspicious tokens.',
      });
    }

    // Security events impact
    if (recentSecurityEvents.length > 0) {
      anomalyPoints += Math.min(recentSecurityEvents.length * 10, 30);
    }

    const calculatedRiskScore = Math.max(0, 100 - anomalyPoints);
    let threatLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (calculatedRiskScore < 40) threatLevel = 'CRITICAL';
    else if (calculatedRiskScore < 60) threatLevel = 'HIGH';
    else if (calculatedRiskScore < 80) threatLevel = 'MEDIUM';

    // Format failed auth trend
    const trendArray = Array.from(hourlyFailures.entries())
      .map(([timestamp, count]) => ({ timestamp, count }))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return {
      workspaceId,
      riskScore: calculatedRiskScore,
      anomalyScore: anomalyPoints,
      threatLevel,
      insights,
      suspiciousActivities,
      failedAuthTrends: {
        totalFailedAttempts: failedAuthLogs.length,
        uniqueIpCount: failedIps.size,
        targetedAccountsCount: targetedUsers.size,
        trend: trendArray,
      },
    };
  }

  /**
   * Run an on-demand active scan and store result
   */
  public static async scanWorkspace(
    workspaceId: string,
    userId: string
  ): Promise<SecurityIntelligenceData> {
    const intelligence = await this.getSecurityIntelligence(workspaceId);

    await AuditLogModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(userId),
      action: 'SECURITY_INTELLIGENCE_SCANNED',
      resource: 'SecurityIntelligence',
      resourceId: workspaceId,
      metadata: {
        anomalyScore: intelligence.anomalyScore,
        threatLevel: intelligence.threatLevel,
        insightsCount: intelligence.insights.length,
      },
    });

    return intelligence;
  }
}

export const auditIntelligenceService = AuditIntelligenceService;
export default AuditIntelligenceService;
