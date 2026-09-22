import mongoose, { Schema } from 'mongoose';

/**
 * Phase 15.6 - Customer lifecycle email templates.
 *
 * Templates are versioned rows so copy can change without a deploy; the
 * defaults below seed the registry on first use. Bodies use {{variable}}
 * placeholders that renderTemplate interpolates - values are HTML-escaped.
 */

export const EMAIL_TEMPLATE_KEYS = [
  'WELCOME',
  'DEMO_CREATED',
  'PAYMENT_SUCCESS',
  'PAYMENT_FAILED',
  'TRIAL_ENDING',
  'USAGE_LIMIT_WARNING',
  'SUBSCRIPTION_RENEWAL',
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export interface IEmailTemplate {
  key: EmailTemplateKey;
  name: string;
  subject: string;
  html: string;
  text: string;
  variables: string[];
  version: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const EmailTemplateSchema = new Schema<IEmailTemplate>({
  key: { type: String, enum: [...EMAIL_TEMPLATE_KEYS], required: true, unique: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  subject: { type: String, required: true, trim: true, maxlength: 200 },
  html: { type: String, required: true, maxlength: 20000 },
  text: { type: String, required: true, maxlength: 20000 },
  variables: { type: [String], default: [] },
  version: { type: Number, required: true, default: 1, min: 1 },
  isActive: { type: Boolean, required: true, default: true },
}, { timestamps: true });

EmailTemplateSchema.index({ isActive: 1 });

export const EmailTemplateModel = mongoose.model<IEmailTemplate>('EmailTemplate', EmailTemplateSchema);

export function isEmailTemplateKey(value: unknown): value is EmailTemplateKey {
  return typeof value === 'string' && (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(value);
}
