import { Types } from 'mongoose';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { createAuditLog } from './auditService.js';

export interface AuditExportOptions {
  workspaceId?: string | Types.ObjectId | undefined;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
  actionTypes?: string[] | undefined;
  userId?: string | Types.ObjectId | undefined;
  format: 'CSV' | 'JSON';
}

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function convertToCsv(records: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(',');
  const rows = records.map((record) =>
    columns.map((col) => escapeCsvCell(record[col])).join(',')
  );
  return [header, ...rows].join('\n');
}

export class AuditExportService {
  /**
   * Export audit logs in CSV or JSON format
   */
  public async exportAuditLogs(
    options: AuditExportOptions,
    userId?: string | Types.ObjectId
  ): Promise<{ data: Buffer; filename: string; mimeType: string }> {
    const query: Record<string, unknown> = {};

    if (options.workspaceId) {
      query.workspaceId = new Types.ObjectId(options.workspaceId.toString());
    }
    if (options.userId) {
      query.userId = new Types.ObjectId(options.userId.toString());
    }
    if (options.actionTypes && options.actionTypes.length > 0) {
      query.action = { $in: options.actionTypes };
    }
    if (options.startDate || options.endDate) {
      query.createdAt = {};
      if (options.startDate) (query.createdAt as any).$gte = options.startDate;
      if (options.endDate) (query.createdAt as any).$lte = options.endDate;
    }

    const logs = await AuditLogModel.find(query)
      .sort({ createdAt: -1 })
      .lean();

    let data: Buffer;
    let filename: string;
    let mimeType: string;

    if (options.format === 'CSV') {
      const fields = [
        '_id',
        'action',
        'userId',
        'workspaceId',
        'resource',
        'resourceId',
        'metadata',
        'ipAddress',
        'userAgent',
        'prevHash',
        'recordHash',
        'signature',
        'createdAt',
      ];

      const csvData = logs.map((log: any) => ({
        _id: log._id?.toString(),
        action: log.action,
        userId: log.userId?.toString() || '',
        workspaceId: log.workspaceId?.toString() || '',
        resource: log.resource,
        resourceId: log.resourceId || '',
        metadata: log.metadata || {},
        ipAddress: log.ipAddress || '',
        userAgent: log.userAgent || '',
        prevHash: log.prevHash || '',
        recordHash: log.recordHash || '',
        signature: log.signature || '',
        createdAt: log.createdAt ? new Date(log.createdAt).toISOString() : '',
      }));

      const csvString = convertToCsv(csvData, fields);
      data = Buffer.from(csvString, 'utf-8');
      filename = `audit-log-export-${Date.now()}.csv`;
      mimeType = 'text/csv';
    } else {
      // JSON format
      data = Buffer.from(JSON.stringify(logs, null, 2), 'utf-8');
      filename = `audit-log-export-${Date.now()}.json`;
      mimeType = 'application/json';
    }

    // Log the export action
    await createAuditLog({
      action: 'AUDIT_EXPORT_REQUESTED',
      userId: userId ? new Types.ObjectId(userId.toString()) : undefined,
      resource: 'AuditLogExport',
      resourceId: `${options.format}-${Date.now()}`,
      metadata: {
        format: options.format,
        recordCount: logs.length,
        workspaceId: options.workspaceId?.toString(),
        dateRange: {
          start: options.startDate?.toISOString(),
          end: options.endDate?.toISOString(),
        },
      },
    });

    return { data, filename, mimeType };
  }
}

export const auditExportService = new AuditExportService();
