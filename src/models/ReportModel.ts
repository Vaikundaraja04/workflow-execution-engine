import mongoose, { Schema, Document, Types } from 'mongoose';

export const REPORT_TYPES = [
  'EXECUTION',
  'WORKFLOW_HEALTH',
  'SECURITY',
  'COMPLIANCE',
  'USAGE',
  'COST',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_STATUSES = ['PENDING', 'GENERATING', 'COMPLETED', 'FAILED'] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_FORMATS = ['JSON', 'CSV', 'PDF'] as const;

export type ReportFormat = (typeof REPORT_FORMATS)[number];

export interface IReportSchedule {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  nextRunAt?: Date;
  isActive: boolean;
  recipients?: string[];
}

export interface IReportFileMetadata {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl?: string;
}

export interface IReport extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  name: string;
  type: ReportType;
  status: ReportStatus;
  generatedBy: Types.ObjectId;
  format: ReportFormat;
  filters?: Record<string, unknown>;
  data?: Record<string, unknown>;
  fileMetadata?: IReportFileMetadata;
  schedule?: IReportSchedule;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReportScheduleSchema = new Schema<IReportSchedule>(
  {
    frequency: { type: String, enum: ['DAILY', 'WEEKLY', 'MONTHLY'], required: true },
    nextRunAt: { type: Date },
    isActive: { type: Boolean, default: true },
    recipients: [{ type: String }],
  },
  { _id: false }
);

const ReportFileMetadataSchema = new Schema<IReportFileMetadata>(
  {
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, default: 0 },
    downloadUrl: { type: String },
  },
  { _id: false }
);

const ReportSchema = new Schema<IReport>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: REPORT_TYPES, required: true },
    status: { type: String, enum: REPORT_STATUSES, default: 'COMPLETED', required: true },
    generatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    format: { type: String, enum: REPORT_FORMATS, default: 'JSON', required: true },
    filters: { type: Schema.Types.Mixed, default: {} },
    data: { type: Schema.Types.Mixed },
    fileMetadata: { type: ReportFileMetadataSchema },
    schedule: { type: ReportScheduleSchema },
    error: { type: String },
  },
  { timestamps: true, minimize: false }
);

ReportSchema.index({ workspaceId: 1, createdAt: -1 });
ReportSchema.index({ workspaceId: 1, type: 1 });
ReportSchema.index({ status: 1 });

export const ReportModel = mongoose.model<IReport>('Report', ReportSchema);
