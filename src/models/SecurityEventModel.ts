import { Schema, model, Document } from 'mongoose';

export interface ISecurityEvent extends Document {
  eventType: string; // e.g., 'BRUTE_FORCE_LOGIN', 'ANOMALOUS_IP', 'API_ABUSE', 'PRIVILEGE_ESCALATION'
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  description: string;
  ipAddress?: string;
  userId?: string; // Reference to User model
  workspaceId?: string; // Reference to Workspace model
  metadata?: Record<string, any>;
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'FALSE_POSITIVE';
  resolutionNotes?: string;
  resolvedAt?: Date;
  resolvedBy?: string; // Reference to User model
  createdAt: Date;
  updatedAt: Date;
}

const SecurityEventSchema = new Schema<ISecurityEvent>(
  {
    eventType: { type: String, required: true, index: true },
    severity: {
      type: String,
      required: true,
      enum: ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      index: true
    },
    title: { type: String, required: true },
    description: { type: String, required: true },
    ipAddress: { type: String },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', index: true },
    metadata: { type: Schema.Types.Mixed },
    status: {
      type: String,
      required: true,
      enum: ['OPEN', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE'],
      default: 'OPEN'
    },
    resolutionNotes: { type: String },
    resolvedAt: { type: Date },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
  }
);

// Indexes for common queries
SecurityEventSchema.index({ eventType: 1, severity: 1, createdAt: -1 });
SecurityEventSchema.index({ workspaceId: 1, createdAt: -1 });
SecurityEventSchema.index({ userId: 1, createdAt: -1 });

export const SecurityEventModel = model<ISecurityEvent>('SecurityEvent', SecurityEventSchema);