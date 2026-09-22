import { leadService } from './leadService.js';
import type { LeadListFilters, LeadRow, LeadFollowUpStatus } from './leadService.js';
import { createAuditLog } from './auditService.js';

/**
 * Phase 15.7 - CRM-ready lead export.
 *
 * Flattens the sales pipeline into the column set a CRM import expects. The
 * export reuses leadService, so score, next action and follow-up status are the
 * same values the sales board renders.
 */

export const LEAD_EXPORT_FORMATS = ['csv', 'json'] as const;
export type LeadExportFormat = (typeof LEAD_EXPORT_FORMATS)[number];

const DEFAULT_EXPORT_LIMIT = 1000;
const MAX_EXPORT_LIMIT = 5000;

const CSV_COLUMNS = [
  'id',
  'company',
  'contact_name',
  'contact_email',
  'contact_phone',
  'industry',
  'company_size',
  'interest',
  'source',
  'status',
  'demo_status',
  'score',
  'score_band',
  'next_action',
  'follow_up_status',
  'owner',
  'estimated_value_monthly',
  'tags',
  'captured_at',
  'last_contacted_at',
  'updated_at',
] as const;

function csvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export interface LeadExportRow {
  id: string;
  company: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  industry: string;
  companySize: string | null;
  interest: string | null;
  source: string;
  status: string;
  demoStatus: string;
  score: number;
  scoreBand: string;
  nextAction: string;
  followUpStatus: LeadFollowUpStatus;
  owner: string | null;
  estimatedValueMonthly: number | null;
  tags: string[];
  capturedAt: string;
  lastContactedAt: string | null;
  updatedAt: string;
}

export interface LeadExportOptions {
  format?: LeadExportFormat | undefined;
  limit?: number | undefined;
  filters?: LeadListFilters | undefined;
  actorUserId?: string | undefined;
}

export interface LeadExportResult {
  format: LeadExportFormat;
  filename: string;
  contentType: string;
  rowCount: number;
  generatedAt: string;
  csv?: string;
  leads?: LeadExportRow[];
}

export function toExportRow(lead: LeadRow): LeadExportRow {
  return {
    id: lead.id,
    company: lead.company,
    contactName: lead.contactName,
    contactEmail: lead.contactEmail,
    contactPhone: lead.contactPhone,
    industry: lead.industry,
    companySize: lead.companySize,
    interest: lead.interest,
    source: lead.source,
    status: lead.status,
    demoStatus: lead.demoStatus,
    score: lead.score.score,
    scoreBand: lead.score.band,
    nextAction: lead.nextAction,
    followUpStatus: lead.followUpStatus,
    owner: lead.assignedTo,
    estimatedValueMonthly: lead.estimatedValueMonthly,
    tags: lead.tags,
    capturedAt: lead.capturedAt.toISOString(),
    lastContactedAt: lead.lastContactedAt ? lead.lastContactedAt.toISOString() : null,
    updatedAt: lead.updatedAt.toISOString(),
  };
}
function toCsvRecord(row: LeadExportRow): Record<string, string | number | null> {
  return {
    id: row.id,
    company: row.company,
    contact_name: row.contactName,
    contact_email: row.contactEmail,
    contact_phone: row.contactPhone,
    industry: row.industry,
    company_size: row.companySize,
    interest: row.interest,
    source: row.source,
    status: row.status,
    demo_status: row.demoStatus,
    score: row.score,
    score_band: row.scoreBand,
    next_action: row.nextAction,
    follow_up_status: row.followUpStatus,
    owner: row.owner,
    estimated_value_monthly: row.estimatedValueMonthly,
    tags: row.tags.join('|'),
    captured_at: row.capturedAt,
    last_contacted_at: row.lastContactedAt,
    updated_at: row.updatedAt,
  };
}

export function toCsv(rows: LeadExportRow[]): string {
  const lines = rows.map((row) => {
    const record = toCsvRecord(row);
    return CSV_COLUMNS.map((column) => csvValue(record[column])).join(',');
  });
  return [CSV_COLUMNS.join(','), ...lines].join('\r\n');
}
export class LeadExportService {
  /** Export the filtered pipeline as CRM-ready CSV or JSON. */
  async export(options: LeadExportOptions = {}): Promise<LeadExportResult> {
    const format: LeadExportFormat = options.format === 'json' ? 'json' : 'csv';
    const limit = Number.isFinite(options.limit) && options.limit && options.limit > 0
      ? Math.min(MAX_EXPORT_LIMIT, Math.floor(options.limit))
      : DEFAULT_EXPORT_LIMIT;

    const rows = (await leadService.exportRows(options.filters ?? {}, limit)).map(toExportRow);
    const generatedAt = new Date().toISOString();
    const filename = 'leads-' + generatedAt.slice(0, 10) + (format === 'csv' ? '.csv' : '.json');

    if (options.actorUserId) {
      await createAuditLog({
        action: 'LEAD_EXPORTED',
        userId: options.actorUserId,
        resource: 'lead',
        resourceId: 'export',
        metadata: { format, rowCount: rows.length, filters: options.filters ?? {} },
      });
    }

    if (format === 'csv') {
      return {
        format,
        filename,
        contentType: 'text/csv; charset=utf-8',
        rowCount: rows.length,
        generatedAt,
        csv: toCsv(rows),
      };
    }

    return {
      format,
      filename,
      contentType: 'application/json; charset=utf-8',
      rowCount: rows.length,
      generatedAt,
      leads: rows,
    };
  }
}

export const leadExportService = new LeadExportService();