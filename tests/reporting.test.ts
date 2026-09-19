import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { ReportService } from '../src/services/reportService.js';
import { ReportModel } from '../src/models/ReportModel.js';
import type { IReport, ReportType, ReportFormat } from '../src/models/ReportModel.js';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

describe('ReportService', () => {
  const workspaceId = new Types.ObjectId().toString();
  const userId = new Types.ObjectId().toString();

  beforeEach(async () => {
    await ReportModel.deleteMany({ workspaceId });
  });

  describe('createReport', () => {
    it('should create and generate a JSON report', async () => {
      const input = {
        name: 'Test Execution Report',
        type: 'EXECUTION' as ReportType,
        format: 'JSON' as ReportFormat,
      };

      const report = await ReportService.createReport(workspaceId, userId, input);

      expect(report).toBeDefined();
      expect(report.name).toBe(input.name);
      expect(report.type).toBe(input.type);
      expect(report.format).toBe(input.format);
      expect(report.status).toBe('COMPLETED');
      expect(report.generatedBy.toString()).toBe(userId);
      expect(report.workspaceId.toString()).toBe(workspaceId);
      expect(report.data).toBeDefined();
      expect(report.fileMetadata).toBeDefined();
      expect(report.fileMetadata?.filename).toContain('test-execution-report');
      expect(report.fileMetadata?.mimeType).toBe('application/json');
      expect(report.fileMetadata?.downloadUrl).toBeDefined();
    });

    it('should create a CSV report', async () => {
      const input = {
        name: 'Test Workflow Health Report',
        type: 'WORKFLOW_HEALTH' as ReportType,
        format: 'CSV' as ReportFormat,
      };

      const report = await ReportService.createReport(workspaceId, userId, input);

      expect(report).toBeDefined();
      expect(report.format).toBe('CSV');
      expect(report.fileMetadata?.mimeType).toBe('text/csv');
    });

    it('should create a PDF report', async () => {
      const input = {
        name: 'Test Security Report',
        type: 'SECURITY' as ReportType,
        format: 'PDF' as ReportFormat,
      };

      const report = await ReportService.createReport(workspaceId, userId, input);

      expect(report).toBeDefined();
      expect(report.format).toBe('PDF');
      expect(report.fileMetadata?.mimeType).toBe('application/pdf');
    });

    it('should create a scheduled report', async () => {
      const input = {
        name: 'Test Scheduled Report',
        type: 'USAGE' as ReportType,
        format: 'JSON' as ReportFormat,
        schedule: {
          frequency: 'DAILY' as const,
          nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          isActive: true,
          recipients: ['test@example.com'],
        },
      };

      const report = await ReportService.createReport(workspaceId, userId, input);

      expect(report).toBeDefined();
      expect(report.schedule).toBeDefined();
      expect(report.schedule?.frequency).toBe('DAILY');
      expect(report.schedule?.isActive).toBe(true);
      expect(report.schedule?.recipients).toEqual(['test@example.com']);
    });
  });

  describe('getReports', () => {
    it('should list reports for a workspace', async () => {
      await ReportService.createReport(workspaceId, userId, {
        name: 'Report 1',
        type: 'EXECUTION' as ReportType,
        format: 'JSON' as ReportFormat,
      });

      await ReportService.createReport(workspaceId, userId, {
        name: 'Report 2',
        type: 'WORKFLOW_HEALTH' as ReportType,
        format: 'JSON' as ReportFormat,
      });

      const reports = await ReportService.getReports(workspaceId, {});

      expect(Array.isArray(reports)).toBe(true);
      expect(reports.length).toBeGreaterThanOrEqual(2);

      reports.forEach(report => {
        expect(report.workspaceId.toString()).toBe(workspaceId);
      });
    });

    it('should filter reports by type', async () => {
      await ReportService.createReport(workspaceId, userId, {
        name: 'Execution Report',
        type: 'EXECUTION' as ReportType,
        format: 'JSON' as ReportFormat,
      });

      await ReportService.createReport(workspaceId, userId, {
        name: 'Workflow Report',
        type: 'WORKFLOW_HEALTH' as ReportType,
        format: 'JSON' as ReportFormat,
      });

      const executionReports = await ReportService.getReports(workspaceId, { type: 'EXECUTION' });
      const workflowReports = await ReportService.getReports(workspaceId, { type: 'WORKFLOW_HEALTH' });

      expect(executionReports.every(r => r.type === 'EXECUTION')).toBe(true);
      expect(workflowReports.every(r => r.type === 'WORKFLOW_HEALTH')).toBe(true);
    });

    it('should filter reports by status', async () => {
      await ReportService.createReport(workspaceId, userId, {
        name: 'Completed Report',
        type: 'EXECUTION' as ReportType,
        format: 'JSON' as ReportFormat,
      });

      const completedReports = await ReportService.getReports(workspaceId, { status: 'COMPLETED' });
      expect(Array.isArray(completedReports)).toBe(true);
    });
  });

  describe('getReportById', () => {
    it('should get a report by ID', async () => {
      const createdReport = await ReportService.createReport(workspaceId, userId, {
        name: 'Test Report',
        type: 'EXECUTION' as ReportType,
        format: 'JSON' as ReportFormat,
      });

      const report = await ReportService.getReportById(createdReport._id.toString(), workspaceId);

      expect(report).toBeDefined();
      expect(report?._id.toString()).toBe(createdReport._id.toString());
      expect(report?.name).toBe('Test Report');
    });

    it('should return null for invalid report ID', async () => {
      const report = await ReportService.getReportById('invalid-id', workspaceId);
      expect(report).toBeNull();
    });

    it('should return null for non-existent report ID', async () => {
      const fakeId = new Types.ObjectId().toString();
      const report = await ReportService.getReportById(fakeId, workspaceId);
      expect(report).toBeNull();
    });
  });

  describe('deleteReport', () => {
    it('should delete a report', async () => {
      const createdReport = await ReportService.createReport(workspaceId, userId, {
        name: 'Test Report to Delete',
        type: 'EXECUTION' as ReportType,
        format: 'JSON' as ReportFormat,
      });

      const result = await ReportService.deleteReport(
        createdReport._id.toString(),
        workspaceId,
        userId
      );

      expect(result).toBe(true);

      const report = await ReportService.getReportById(
        createdReport._id.toString(),
        workspaceId
      );
      expect(report).toBeNull();
    });

    it('should return false for invalid report ID', async () => {
      const result = await ReportService.deleteReport(
        'invalid-id',
        workspaceId,
        userId
      );
      expect(result).toBe(false);
    });
  });

  describe('exportReport', () => {
    it('should export report as JSON', async () => {
      const createdReport = await ReportService.createReport(workspaceId, userId, {
        name: 'Test Export Report',
        type: 'EXECUTION' as ReportType,
        format: 'JSON' as ReportFormat,
      });

      const exported = await ReportService.exportReport(
        createdReport._id.toString(),
        workspaceId
      );

      expect(exported).toBeDefined();
      expect(exported.data).toBeDefined();
      expect(exported.filename).toContain('test-export-report');
      expect(exported.mimeType).toBe('application/json');

      const parsed = JSON.parse(exported.data);
      expect(parsed).toBeDefined();
      expect(parsed.reportType).toBe('EXECUTION');
    });

    it('should export report as CSV', async () => {
      const createdReport = await ReportService.createReport(workspaceId, userId, {
        name: 'Test CSV Export',
        type: 'WORKFLOW_HEALTH' as ReportType,
        format: 'CSV' as ReportFormat,
      });

      const exported = await ReportService.exportReport(
        createdReport._id.toString(),
        workspaceId
      );

      expect(exported).toBeDefined();
      expect(exported.mimeType).toBe('text/csv');
      expect(exported.filename).toMatch(/\.csv$/);
      expect(exported.data).toContain('section,metric,value');
    });

    it('should export report as PDF', async () => {
      const createdReport = await ReportService.createReport(workspaceId, userId, {
        name: 'Test PDF Export',
        type: 'SECURITY' as ReportType,
        format: 'PDF' as ReportFormat,
      });

      const exported = await ReportService.exportReport(
        createdReport._id.toString(),
        workspaceId
      );

      expect(exported).toBeDefined();
      expect(exported.mimeType).toBe('application/pdf');
      expect(exported.filename).toMatch(/\.pdf$/);
      expect(exported.data).toContain('# Enterprise Report:');
    });

    it('should override format during export', async () => {
      const createdReport = await ReportService.createReport(workspaceId, userId, {
        name: 'Format Override Test',
        type: 'EXECUTION' as ReportType,
        format: 'JSON' as ReportFormat,
      });

      const exported = await ReportService.exportReport(
        createdReport._id.toString(),
        workspaceId,
        'CSV' as ReportFormat
      );

      expect(exported.mimeType).toBe('text/csv');
      expect(exported.filename).toMatch(/\.csv$/);
    });

    it('should throw error for non-existent report', async () => {
      await expect(
        ReportService.exportReport('non-existent-id', workspaceId)
      ).rejects.toThrow('REPORT_NOT_FOUND');
    });
  });
});
