import mongoose, { Schema, Document, Types } from 'mongoose';

export type RegionStatus = 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';

export interface IRegion extends Document<Types.ObjectId> {
  name: string; // human-readable name like "US East (N. Virginia)"
  code: string; // region code like "us-east-1"
  status: RegionStatus;
  endpoints: {
    api: string; // internal API endpoint for this region
    ws?: string; // websocket endpoint
  };
  metadata?: Record<string, unknown>; // for cloud provider specific info
  createdAt: Date;
  updatedAt: Date;
}

const RegionSchema = new Schema<IRegion>({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, trim: true, lowercase: true },
  status: { type: String, enum: ['ACTIVE', 'MAINTENANCE', 'INACTIVE'], default: 'ACTIVE' },
  endpoints: {
    api: { type: String, required: true },
    ws: { type: String },
  },
  metadata: { type: Schema.Types.Mixed },
}, { timestamps: true });

RegionSchema.index({ status: 1 });

export const RegionModel = mongoose.model<IRegion>('Region', RegionSchema);