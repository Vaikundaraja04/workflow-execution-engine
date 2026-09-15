import mongoose, { Schema, Document, Types } from 'mongoose';

export type SubscriptionPlan = 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
export type SubscriptionStatus = 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED';

export interface ISubscription extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  billingProvider: string; // e.g., 'stripe', 'razorpay', 'paddle'
  externalCustomerId: string;
  externalSubscriptionId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema = new Schema<ISubscription>({
  workspaceId: {
    type: Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    unique: true
  },
  plan: {
    type: String,
    enum: ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'],
    required: true
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED', 'EXPIRED'],
    required: true
  },
  billingProvider: { type: String, required: true },
  externalCustomerId: { type: String, required: true },
  externalSubscriptionId: { type: String, required: true },
  currentPeriodStart: { type: Date, required: true },
  currentPeriodEnd: { type: Date, required: true },
  trialEndsAt: { type: Date, default: null },
}, { timestamps: true });

SubscriptionSchema.index({ status: 1 });
SubscriptionSchema.index({ currentPeriodEnd: 1 });

export const SubscriptionModel = mongoose.model<ISubscription>('Subscription', SubscriptionSchema);