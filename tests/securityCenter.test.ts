import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SecurityCenterService } from '../src/services/securityCenterService.js';
import { SecurityEventModel } from '../src/models/SecurityEventModel.js';
import { Types } from 'mongoose';
import type { RiskScoreData, SecuritySeverity } from '../src/types/security.types.js';

// Mock SecurityEventModel
vi.mock('../src/models/SecurityEventModel.js');

describe('SecurityCenterService', () => {
  const mockWorkspaceId = new Types.ObjectId().toString();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateRiskScore', () => {
    it('should return a risk score with breakdown and recommendations', async () => {
      const result = await SecurityCenterService.getRiskScore(mockWorkspaceId);

      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('level');
      expect(result).toHaveProperty('breakdown');
      expect(result).toHaveProperty('recommendations');

      expect(Array.isArray(result.breakdown)).toBe(true);
      expect(result.breakdown.length).toBe(4);
      expect(Array.isArray(result.recommendations)).toBe(true);
    });
  });

  describe('logSecurityEvent', () => {
    it('should create and save a security event', async () => {
      const eventData = {
        eventType: 'BRUTE_FORCE_LOGIN',
        severity: 'HIGH' as SecuritySeverity,
        title: 'Brute force login detected',
        description: 'Multiple failed login attempts from same IP',
        ipAddress: '192.168.1.100',
        workspaceId: mockWorkspaceId,
        userId: new Types.ObjectId().toString(),
      };

      const savedEvent = { _id: new Types.ObjectId(), ...eventData, createdAt: new Date(), updatedAt: new Date() };
      (SecurityEventModel.prototype.save as any).mockResolvedValue(savedEvent);

      const result = await SecurityCenterService.logSecurityEvent(eventData);

      expect(SecurityEventModel).toHaveBeenCalledWith(expect.objectContaining(eventData));
      expect(result).toMatchObject(savedEvent);
    });
  });

  describe('getSecurityEvents', () => {
    it('should return paginated security events with filters', async () => {
      const mockEvents = [
        { _id: new Types.ObjectId(), eventType: 'BRUTE_FORCE_LOGIN', severity: 'HIGH', workspaceId: new Types.ObjectId(mockWorkspaceId) },
        { _id: new Types.ObjectId(), eventType: 'ANOMALOUS_IP', severity: 'MEDIUM', workspaceId: new Types.ObjectId(mockWorkspaceId) },
      ];
      const mockTotal = 2;

      (SecurityEventModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(mockEvents),
      });
      (SecurityEventModel.countDocuments as any).mockResolvedValue(mockTotal);

      const filters = { eventType: 'BRUTE_FORCE_LOGIN', workspaceId: mockWorkspaceId };
      const pagination = { limit: 10, offset: 0 };

      const result = await SecurityCenterService.getSecurityEvents(filters, pagination);

      expect(result.events).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
      expect(SecurityEventModel.find).toHaveBeenCalledWith({
        eventType: 'BRUTE_FORCE_LOGIN',
        workspaceId: expect.any(Object), // ObjectId
      });
      expect(SecurityEventModel.countDocuments).toHaveBeenCalledWith({
        eventType: 'BRUTE_FORCE_LOGIN',
        workspaceId: expect.any(Object),
      });
    });
  });

  describe('resolveSecurityEvent', () => {
    it('should resolve a security event with notes and status', async () => {
      const eventId = new Types.ObjectId().toString();
      const resolutionNotes = 'Investigated and resolved';
      const status = 'RESOLVED';
      const resolvedBy = new Types.ObjectId().toString();

      const mockEvent = {
        _id: eventId,
        status: 'OPEN',
        save: vi.fn().mockResolvedValue({
          _id: eventId,
          status,
          resolutionNotes,
          resolvedAt: new Date(),
          resolvedBy: new Types.ObjectId(resolvedBy),
        }),
      };

      (SecurityEventModel.findById as any).mockResolvedValue(mockEvent);

      const result = await SecurityCenterService.resolveSecurityEvent(eventId, resolutionNotes, status, resolvedBy);

      expect(SecurityEventModel.findById).toHaveBeenCalledWith(eventId);
      expect(mockEvent.save).toHaveBeenCalled();
      expect(result.status).toBe(status);
      expect(result.resolutionNotes).toBe(resolutionNotes);
    });

    it('should throw an error if event not found', async () => {
      (SecurityEventModel.findById as any).mockResolvedValue(null);

      await expect(
        SecurityCenterService.resolveSecurityEvent('invalid-id', 'notes', 'RESOLVED', 'user-id')
      ).rejects.toThrow('Security event not found');
    });
  });

  describe('getSecurityDashboard', () => {
    it('should return dashboard summary data', async () => {
      const result = await SecurityCenterService.getSecurityDashboard(mockWorkspaceId);

      expect(result).toHaveProperty('workflowsExecuted');
      expect(result).toHaveProperty('activeUsers');
      expect(result).toHaveProperty('securityEvents');
      expect(result).toHaveProperty('apiCalls');

      expect(typeof result.workflowsExecuted).toBe('number');
      expect(typeof result.activeUsers).toBe('number');
      expect(typeof result.securityEvents).toBe('number');
      expect(typeof result.apiCalls).toBe('number');
    });
  });
});