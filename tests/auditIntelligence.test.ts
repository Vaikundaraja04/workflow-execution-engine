import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { AuditIntelligenceService } from '../src/services/auditIntelligenceService.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import type { SecurityIntelligenceData } from '../src/types/operations.types.js';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

describe('AuditIntelligenceService', () => {
  const workspaceId = new Types.ObjectId().toString();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({ workspaceId });
  });

  describe('getSecurityIntelligence', () => {
    it('should return security intelligence data', async () => {
      const result: SecurityIntelligenceData = await AuditIntelligenceService.getSecurityIntelligence(workspaceId);

      expect(result).toHaveProperty('workspaceId', workspaceId);
      expect(result).toHaveProperty('riskScore');
      expect(result).toHaveProperty('anomalyScore');
      expect(result).toHaveProperty('threatLevel');
      expect(result).toHaveProperty('insights');
      expect(result).toHaveProperty('suspiciousActivities');
      expect(result).toHaveProperty('failedAuthTrends');

      expect(typeof result.riskScore).toBe('number');
      expect(typeof result.anomalyScore).toBe('number');
      expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(result.threatLevel);
      expect(Array.isArray(result.insights)).toBe(true);
      expect(Array.isArray(result.suspiciousActivities)).toBe(true);

      expect(result.failedAuthTrends).toHaveProperty('totalFailedAttempts');
      expect(result.failedAuthTrends).toHaveProperty('uniqueIpCount');
      expect(result.failedAuthTrends).toHaveProperty('targetedAccountsCount');
      expect(result.failedAuthTrends).toHaveProperty('trend');

      expect(typeof result.failedAuthTrends.totalFailedAttempts).toBe('number');
      expect(typeof result.failedAuthTrends.uniqueIpCount).toBe('number');
      expect(typeof result.failedAuthTrends.targetedAccountsCount).toBe('number');
      expect(Array.isArray(result.failedAuthTrends.trend)).toBe(true);
    });

    it('records the on-demand scan timestamp in lastScannedAt', async () => {
      const userId = new Types.ObjectId().toString();

      const before = await AuditIntelligenceService.getSecurityIntelligence(workspaceId);
      expect(before.lastScannedAt).toBeUndefined();

      const scanned = await AuditIntelligenceService.scanWorkspace(workspaceId, userId);
      expect(scanned.lastScannedAt).toBeDefined();
      expect(Number.isNaN(Date.parse(scanned.lastScannedAt as string))).toBe(false);

      // Subsequent reads surface the stored scan time so the UI can show "Last scan".
      const after = await AuditIntelligenceService.getSecurityIntelligence(workspaceId);
      expect(after.lastScannedAt).toBe(scanned.lastScannedAt);
    });
  });
});
