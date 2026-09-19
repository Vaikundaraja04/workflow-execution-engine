import { Types } from 'mongoose';
import { ReportModel } from '../models/ReportModel.js';
import type { IReport, ReportType, ReportStatus, ReportFormat } from '../models/ReportModel.js';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { EnterpriseAnalyticsService } from './enterpriseAnalyticsService.js';
import { securityCenterService } from './securityCenterService.js';
import { complianceReportService } from './complianceReportService.js';

export interface CreateReportInput {
  name: string;
  type: ReportType;
  format?: ReportFormat;
  filters?: Record<string, unknown>;
  schedule?: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    nextRunAt?: Date;
    isActive: boolean;
    recipients?: string[];
  };
}

export class ReportService {
  /**
   * Create and generate a new Report
   */
  public static async createReport(
    workspaceId: string,
    userId: string,
    input: CreateReportInput
  ): Promise<IReport> {
    const wsId = new Types.ObjectId(workspaceId);
    const uId = new Types.ObjectId(userId);
    const format = input.format || 'JSON';

    // Generate report payload according to type
    const reportData = await this.generateReportData(input.type, workspaceId, input.filters);

    const filename = `${input.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}.${format.toLowerCase()}`;
    const payloadString = JSON.stringify(reportData, null, 2);
    const sizeBytes = Buffer.byteLength(payloadString, 'utf8');

    const createPayload: Record<string, unknown> = {
      workspaceId: wsId,
      name: input.name,
      type: input.type,
      status: 'COMPLETED',
      generatedBy: uId,
      format,
      filters: input.filters || {},
      data: reportData,
      fileMetadata: {
        filename,
        mimeType: format === 'CSV' ? 'text/csv' : format === 'PDF' ? 'application/pdf' : 'application/json',
        sizeBytes,
        downloadUrl: `/api/v1/reports/download/${filename}`,
      },
    };
    if (input.schedule) {
      createPayload.schedule = input.schedule;
    }

    const report = (await ReportModel.create(createPayload)) as IReport;

    // Record audit log
    await AuditLogModel.create({
      workspaceId: wsId,
      userId: uId,
      action: 'REPORT_GENERATED',
      resource: 'Report',
      resourceId: (report as any)._id.toString(),
      metadata: { reportName: input.name, type: input.type, format },
    });

    return report;
  }

  /**
   * List reports for a workspace
   */
  public static async getReports(
    workspaceId: string,
    filters: { type?: string; status?: string } = {}
  ): Promise<IReport[]> {
    const wsId = new Types.ObjectId(workspaceId);
    const query: Record<string, unknown> = { workspaceId: wsId };

    if (filters.type) query.type = filters.type.toUpperCase();
    if (filters.status) query.status = filters.status.toUpperCase();

    return ReportModel.find(query).sort({ createdAt: -1 }).lean() as any;
  }

  /**
   * Get single report by ID
   */
  public static async getReportById(
    reportId: string,
    workspaceId: string
  ): Promise<IReport | null> {
    if (!Types.ObjectId.isValid(reportId)) return null;
    return ReportModel.findOne({
      _id: new Types.ObjectId(reportId),
      workspaceId: new Types.ObjectId(workspaceId),
    }).lean() as any;
  }

  /**
   * Delete a report
   */
  public static async deleteReport(
    reportId: string,
    workspaceId: string,
    userId: string
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(reportId)) return false;
    const wsId = new Types.ObjectId(workspaceId);
    const rId = new Types.ObjectId(reportId);

    const report = await ReportModel.findOneAndDelete({ _id: rId, workspaceId: wsId });
    if (!report) return false;

    await AuditLogModel.create({
      workspaceId: wsId,
      userId: new Types.ObjectId(userId),
      action: 'REPORT_DELETED',
      resource: 'Report',
      resourceId: reportId,
      metadata: { reportName: report.name },
    });

    return true;
  }

  /**
   * Export report file data in specific format (JSON, CSV, PDF)
   */
  public static async exportReport(
    reportId: string,
    workspaceId: string,
    formatOverride?: ReportFormat
  ): Promise<{ data: string; filename: string; mimeType: string }> {
    const report = await this.getReportById(reportId, workspaceId);
    if (!report) {
      throw new Error('REPORT_NOT_FOUND');
    }

    const format = formatOverride || report.format || 'JSON';
    const timestamp = new Date().toISOString().slice(0, 10);
    const baseName = report.name.toLowerCase().replace(/[^a-z0-9]/g, '-');

    if (format === 'CSV') {
      let csv = 'section,metric,value\n';
      const flatten = (obj: any, prefix = '') => {
        for (const [k, v] of Object.entries(obj || {})) {
          const key = prefix ? `${prefix}.${k}` : k;
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            flatten(v, key);
          } else if (Array.isArray(v)) {
            csv += `"${report.type}","${key}","${JSON.stringify(v).replace(/"/g, '""')}"\n`;
          } else {
            csv += `"${report.type}","${key}","${v}"\n`;
          }
        }
      };
      flatten(report.data || {});

      return {
        data: csv,
        filename: `${baseName}-${timestamp}.csv`,
        mimeType: 'text/csv',
      };
    }

    if (format === 'PDF') {
      // Return structured markdown/text format representation for PDF streaming
      const pdfText = `# Enterprise Report: ${report.name}\nGenerated: ${new Date().toISOString()}\nType: ${report.type}\nWorkspace: ${workspaceId}\n\n## Executive Summary\n${JSON.stringify(report.data, null, 2)}`;
      return {
        data: pdfText,
        filename: `${baseName}-${timestamp}.pdf`,
        mimeType: 'application/pdf',
      };
    }

    return {
      data: JSON.stringify(report.data || {}, null, 2),
      filename: `${baseName}-${timestamp}.json`,
      mimeType: 'application/json',
    };
  }

  /**
   * Generate raw data content for a report type
   */
  public static async generateReportData(
    type: ReportType,
    workspaceId: string,
    filters?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const timeframe = (filters?.timeframe as string) || '30d';

    switch (type) {
      case 'EXECUTION': {
        const executions = await EnterpriseAnalyticsService.getExecutionAnalytics(workspaceId, timeframe);
        return {
          reportType: 'EXECUTION',
          generatedAt: new Date().toISOString(),
          timeframe,
          metrics: executions,
        };
      }

      case 'WORKFLOW_HEALTH': {
        const workflows = await EnterpriseAnalyticsService.getWorkflowAnalytics(workspaceId, timeframe);
        const performance = await EnterpriseAnalyticsService.getPerformanceAnalytics(workspaceId, timeframe);
        return {
          reportType: 'WORKFLOW_HEALTH',
          generatedAt: new Date().toISOString(),
          workflows: workflows.workflows,
          failingNodes: workflows.mostFailingNodes,
          performanceSummary: {
            p50Ms: performance.p50DurationMs,
            p95Ms: performance.p95DurationMs,
            slowestWorkflows: performance.slowestWorkflows,
          },
        };
      }

      case 'SECURITY': {
        const riskScore = await securityCenterService.calculateRiskScore(workspaceId);
        const overview = await EnterpriseAnalyticsService.getOverviewAnalytics(workspaceId, timeframe);
        return {
          reportType: 'SECURITY',
          generatedAt: new Date().toISOString(),
          riskScore: riskScore.score,
          level: riskScore.level,
          breakdown: riskScore.breakdown,
          recommendations: riskScore.recommendations,
          activeUsers: overview.activeUsersCount,
        };
      }

      case 'COMPLIANCE': {
        const [soc2, gdpr, iso27001] = await Promise.all([
          complianceReportService.generateSoc2Report(workspaceId),
          complianceReportService.generateGdprReport(workspaceId),
          complianceReportService.generateIso27001Report(workspaceId),
        ]);
        return {
          reportType: 'COMPLIANCE',
          generatedAt: new Date().toISOString(),
          frameworks: {
            soc2,
            gdpr,
            iso27001,
          },
        };
      }

      case 'COST': {
        const cost = await EnterpriseAnalyticsService.getCostAnalytics(workspaceId, timeframe);
        return {
          reportType: 'COST',
          generatedAt: new Date().toISOString(),
          timeframe,
          costBreakdown: cost,
        };
      }

      case 'USAGE':
      default: {
        const overview = await EnterpriseAnalyticsService.getOverviewAnalytics(workspaceId, timeframe);
        const users = await EnterpriseAnalyticsService.getUserAnalytics(workspaceId, timeframe);
        return {
          reportType: 'USAGE',
          generatedAt: new Date().toISOString(),
          timeframe,
          workspaceOverview: overview,
          memberProductivity: users.users,
        };
      }
    }
  }
}

export default ReportService;
