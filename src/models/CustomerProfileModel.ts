import mongoose, { Schema, Types } from 'mongoose';

export interface ISupportNote {
  authorUserId: Types.ObjectId;
  note: string;
  createdAt: Date;
}

export interface ICustomerProfile {
  tenantId: Types.ObjectId;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  company: string;
  billingAddress?: {
    line1?: string;
    city?: string;
    country?: string;
  } | null;
  taxId?: string | null;
  timezone: string;
  locale: string;
  supportNotes: ISupportNote[];
  createdAt: Date;
  updatedAt: Date;
}

const SupportNoteSchema = new Schema<ISupportNote>({
  authorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  note: { type: String, required: true, maxlength: 2000 },
  createdAt: { type: Date, required: true, default: Date.now },
}, { _id: false });

const CustomerProfileSchema = new Schema<ICustomerProfile>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
  contactName: { type: String, required: true, trim: true, maxlength: 160 },
  contactEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  contactPhone: { type: String, default: null, maxlength: 40 },
  company: { type: String, required: true, trim: true, maxlength: 160 },
  billingAddress: {
    type: new Schema({
      line1: { type: String, maxlength: 200 },
      city: { type: String, maxlength: 100 },
      country: { type: String, maxlength: 2 },
    }, { _id: false }),
    default: null,
  },
  taxId: { type: String, default: null, maxlength: 40 },
  timezone: { type: String, required: true, default: 'UTC' },
  locale: { type: String, required: true, default: 'en' },
  supportNotes: { type: [SupportNoteSchema], default: [] },
}, { timestamps: true });

CustomerProfileSchema.index({ contactEmail: 1 });

export const CustomerProfileModel = mongoose.model<ICustomerProfile>(
  'CustomerProfile',
  CustomerProfileSchema,
);