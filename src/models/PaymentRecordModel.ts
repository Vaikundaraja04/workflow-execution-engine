import mongoose, { Schema, Types } from 'mongoose';

/**
 * Phase 15.3 - Self-serve checkout payment history.
 *
 * When a checkout payment is verified through a provider it is recorded here so
 * the customer console can show payment history without asking the provider to
 * list payments (the mock provider cannot, and Stripe/Razorpay would need extra
 * list endpoints). The provider remains the source of truth for settlement;
 * this record is the verified snapshot the platform saw.
 */

export const PAYMENT_RECORD_STATUSES = [
  'succeeded',
  'processing',
  'requires_action',
  'failed',
  'refunded',
  'unknown',
] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

export interface IPaymentRecord {
  workspaceId: Types.ObjectId;
  provider: string;
  paymentId: string;
  customerId?: string | null;
  packageId?: string | null;
  plan?: string | null;
  amount: number;
  amountReceived: number;
  refundedAmount: number;
  currency: string;
  status: PaymentRecordStatus;
  method?: string | null;
  paid: boolean;
  activated: boolean;
  providerCreatedAt: number;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentRecordSchema = new Schema<IPaymentRecord>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  provider: { type: String, required: true, maxlength: 32 },
  paymentId: { type: String, required: true, maxlength: 191 },
  customerId: { type: String, maxlength: 191, default: null },
  packageId: { type: String, maxlength: 32, default: null },
  plan: { type: String, maxlength: 32, default: null },
  amount: { type: Number, required: true, min: 0 },
  amountReceived: { type: Number, required: true, min: 0, default: 0 },
  refundedAmount: { type: Number, required: true, min: 0, default: 0 },
  currency: { type: String, required: true, maxlength: 8 },
  status: { type: String, enum: [...PAYMENT_RECORD_STATUSES], required: true, default: 'unknown' },
  method: { type: String, maxlength: 32, default: null },
  paid: { type: Boolean, required: true, default: false },
  activated: { type: Boolean, required: true, default: false },
  providerCreatedAt: { type: Number, required: true, default: 0 },
}, { timestamps: true });

PaymentRecordSchema.index({ workspaceId: 1, createdAt: -1 });
PaymentRecordSchema.index({ provider: 1, paymentId: 1 }, { unique: true });

export const PaymentRecordModel = mongoose.model<IPaymentRecord>('PaymentRecord', PaymentRecordSchema);
