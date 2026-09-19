import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IRetentionPolicy extends mongoose.Document {
  workspaceId: mongoose.Types.ObjectId;
  resourceType: string; // e.g., 'audit', 'execution', 'webhook-delivery'
  retentionDays: number; // How many days to retain
  createdAt: Date;
  updatedAt: Date;
}

const RetentionPolicySchema = new Schema<IRetentionPolicy>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true, index: true },
    resourceType: { type: String, required: true, maxlength: 64 },
    retentionDays: { type: Number, required: true, min: 0, max: 3650 }, // up to 10 years
  },
  { timestamps: true }
);

export const RetentionPolicyModel = mongoose.model<IRetentionPolicy>('RetentionPolicy', RetentionPolicySchema);