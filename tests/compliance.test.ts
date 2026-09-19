/// <reference types="vitest" />
import { ComplianceReportService } from '../src/services/complianceReportService.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { PrivacyRequestModel, type IPrivacyRequest, type PrivacyRequestType, type PrivacyRequestStatus } from '../src/models/PrivacyRequestModel.js';
import { WorkspaceSecurityPolicyModel } from '../src/models/WorkspaceSecurityPolicyModel.js';
import { RetentionPolicyModel } from '../src/models/RetentionPolicyModel.js';
import { SecretModel } from '../src/models/SecretModel.js';
import { UserSessionModel } from '../src/models/UserSessionModel.js';
import { SecurityEventModel } from '../src/models/SecurityEventModel.js';
import { APIKeyModel } from '../src/models/APIKeyModel.js';
import { createAuditLog } from '../src/services/auditService.js';
import { Types } from 'mongoose';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock all the models
vi.mock('../src/models/AuditLogModel.js');
vi.mock('../src/models/PrivacyRequestModel.js');
vi.mock('../src/models/WorkspaceSecurityPolicyModel.js');
vi.mock('../src/models/RetentionPolicyModel.js');
vi.mock('../src/models/SecretModel.js');
vi.mock('../src/models/UserSessionModel.js');
vi.mock('../src/models/SecurityEventModel.js');
vi.mock('../src/models/APIKeyModel.js');
vi.mock('../src/services/auditService.js');

describe('ComplianceReportService', () => {
  const mockWorkspaceId = new Types.ObjectId().toString();
  const complianceService = new ComplianceReportService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateSoc2Report', () => {
    it('should generate a SOC2 report with all sections', async () => {
      // Mock WorkspaceSecurityPolicyModel.findOne
      (WorkspaceSecurityPolicyModel.findOne as any).mockResolvedValue({
        passwordMinLength: 12,
      });

      // Mock AuditLogModel.countDocuments
      (AuditLogModel.countDocuments as any)
        .mockResolvedValueOnce(10) // totalConfigChanges
        .mockResolvedValueOnce(2)  // unauthorizedChanges
        .mockResolvedValueOnce(0); // emergencyChanges

      // Mock SecurityEventModel.countDocuments
      (SecurityEventModel.countDocuments as any)
        .mockResolvedValueOnce(5)  // totalIncidents (status != OPEN)
        .mockResolvedValueOnce(4)  // resolvedIncidents
        .mockResolvedValueOnce(1); // falsePositives

      const result = await complianceService.generateSoc2Report(mockWorkspaceId);

      expect(result).toHaveProperty('accessManagement');
      expect(result).toHaveProperty('changeManagement');
      expect(result).toHaveProperty('encryption');
      expect(result).toHaveProperty('incidentResponse');
      expect(result).toHaveProperty('availability');
      expect(result).toHaveProperty('confidentiality');

      // Check some values
      expect(result.accessManagement.passwordPolicyCompliant).toBe(true);
      expect(result.changeManagement.totalConfigChanges).toBe(10);
      expect(result.changeManagement.unauthorizedChanges).toBe(2);
      expect(result.changeManagement.emergencyChanges).toBe(0);
      expect(result.changeManagement.changeApprovalRate).toBe(80); // (10-2)/10*100
      expect(result.incidentResponse.totalIncidents).toBe(5);
      expect(result.incidentResponse.resolvedIncidents).toBe(4);
      expect(result.incidentResponse.falsePositives).toBe(1);
    });
  });

  describe('generateGdprReport', () => {
    it('should generate a GDPR report with all articles', async () => {
      // Mock PrivacyRequestModel.countDocuments
      (PrivacyRequestModel.countDocuments as any)
        .mockResolvedValueOnce(5) // dataExportRequests
        .mockResolvedValueOnce(3) // completedExports
        .mockResolvedValueOnce(2) // deletionRequests
        .mockResolvedValueOnce(1); // completedDeletions

      const result = await complianceService.generateGdprReport(mockWorkspaceId);

      expect(result).toHaveProperty('article15');
      expect(result).toHaveProperty('article17');
      expect(result).toHaveProperty('article30');
      expect(result).toHaveProperty('article32');

      expect(result.article15.dataExportRequests).toBe(5);
      expect(result.article15.completedExports).toBe(3);
      expect(result.article15.averageProcessingTimeHours).toBe(24);

      expect(result.article17.deletionRequests).toBe(2);
      expect(result.article17.completedDeletions).toBe(1);
      expect(result.article17.averageProcessingTimeHours).toBe(24);

      expect(Array.isArray(result.article30.processingActivities)).toBe(true);
      expect(result.article30.processingActivities.length).toBeGreaterThan(0);

      expect(Array.isArray(result.article32.technicalMeasures)).toBe(true);
      expect(Array.isArray(result.article32.organizationalMeasures)).toBe(true);
    });
  });

  describe('generateIso27001Report', () => {
    it('should generate an ISO27001 report with all sections', async () => {
      const result = await complianceService.generateIso27001Report(mockWorkspaceId);

      expect(result).toHaveProperty('a5');
      expect(result).toHaveProperty('a6');
      expect(result).toHaveProperty('a7');
      expect(result).toHaveProperty('a8');
      expect(result).toHaveProperty('a9');
      expect(result).toHaveProperty('a10');
      expect(result).toHaveProperty('a11');
      expect(result).toHaveProperty('a12');
      expect(result).toHaveProperty('a13');
      expect(result).toHaveProperty('a14');
      expect(result).toHaveProperty('a15');
      expect(result).toHaveProperty('a16');
      expect(result).toHaveProperty('a17');
      expect(result).toHaveProperty('a18');

      // Check a few placeholders
      expect(result.a5.policiesReviewed).toBe(true);
      expect(result.a6.rolesDefined).toBe(true);
      expect(result.a7.securityTraining).toBe(true);
      expect(result.a9.accessPolicy).toBe(true);
      expect(result.a9.userAccessManagement).toBe(true);
      expect(result.a9.privilegedAccessRestricted).toBe(true);
      expect(result.a9.secretAuthentication).toBe(true);
    });
  });

  describe('logReportGeneration', () => {
    it('should create an audit log for report generation', async () => {
      const mockUserId = new Types.ObjectId().toString();
      (createAuditLog as any).mockResolvedValue(undefined);

      await complianceService.logReportGeneration('SOC2', mockWorkspaceId, mockUserId);

      expect(createAuditLog).toHaveBeenCalledWith({
        action: 'COMPLIANCE_REPORT_GENERATED',
        workspaceId: expect.any(Object), // ObjectId
        userId: expect.any(Object), // ObjectId
        resource: 'ComplianceReport',
        resourceId: expect.stringContaining('SOC2-'),
        metadata: {
          reportType: 'SOC2',
          generatedAt: expect.any(String),
        },
      });
    });
  });
});