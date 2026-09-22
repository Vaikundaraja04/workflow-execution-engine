import { EmailTemplateModel } from '../../models/EmailTemplateModel.js';
import type { EmailTemplateKey, IEmailTemplate } from '../../models/EmailTemplateModel.js';

/**
 * Phase 15.6 - Default lifecycle email templates.
 *
 * Copy is deliberately plain and factual: what happened, what to do next, where
 * to find it. Bodies interpolate {{variables}}; renderTemplate escapes values
 * before substitution.
 */

export interface EmailTemplateSeed {
  key: EmailTemplateKey;
  name: string;
  subject: string;
  html: string;
  text: string;
  variables: string[];
}

function layout(body: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111827">${body}<p style="margin-top:24px;font-size:12px;color:#6b7280">Workflow Execution Engine</p></div>`;
}

const CORE_TEMPLATES: Pick<Record<EmailTemplateKey, EmailTemplateSeed>, 'WELCOME' | 'DEMO_CREATED'> = {
  WELCOME: {
    key: 'WELCOME',
    name: 'Welcome',
    subject: 'Welcome to {{companyName}} on Workflow Execution Engine',
    html: layout('<p>Hi {{contactName}},</p><p>Your workspace <strong>{{workspaceName}}</strong> is ready. The onboarding wizard walks you through choosing your industry, installing a solution package and creating your first workflow.</p><p><a href="{{onboardingUrl}}">Continue onboarding</a></p>'),
    text: 'Hi {{contactName}},\n\nYour workspace {{workspaceName}} is ready. Continue onboarding: {{onboardingUrl}}\n\nWorkflow Execution Engine',
    variables: ['contactName', 'companyName', 'workspaceName', 'onboardingUrl'],
  },
  DEMO_CREATED: {
    key: 'DEMO_CREATED',
    name: 'Demo workspace created',
    subject: 'Your demo sandbox is ready',
    html: layout('<p>Hi {{contactName}},</p><p>Your demo workspace <strong>{{workspaceName}}</strong> is live until {{expiresAt}}. It is pre-loaded with sample workflows and an agent so you can evaluate the engine end to end.</p>'),
    text: 'Hi {{contactName}},\n\nYour demo workspace {{workspaceName}} is live until {{expiresAt}}.\n\nWorkflow Execution Engine',
    variables: ['contactName', 'workspaceName', 'expiresAt'],
  },
};

const BILLING_TEMPLATES: Pick<Record<EmailTemplateKey, EmailTemplateSeed>, 'PAYMENT_SUCCESS' | 'PAYMENT_FAILED'> = {
  PAYMENT_SUCCESS: {
    key: 'PAYMENT_SUCCESS',
    name: 'Payment success',
    subject: 'Payment received - {{packageName}} plan active',
    html: layout('<p>Hi {{contactName}},</p><p>We received your payment of <strong>{{amount}} {{currency}}</strong>. Your workspace is now on the <strong>{{packageName}}</strong> plan and the new limits are active immediately.</p>'),
    text: 'Hi {{contactName}},\n\nPayment of {{amount}} {{currency}} received. Your workspace is now on the {{packageName}} plan.\n\nWorkflow Execution Engine',
    variables: ['contactName', 'amount', 'currency', 'packageName'],
  },
  PAYMENT_FAILED: {
    key: 'PAYMENT_FAILED',
    name: 'Payment failed',
    subject: 'We could not process your payment',
    html: layout('<p>Hi {{contactName}},</p><p>The payment for your <strong>{{packageName}}</strong> subscription could not be processed, so the workspace is marked past due. Update the payment method in the billing console to avoid an interruption.</p>'),
    text: 'Hi {{contactName}},\n\nThe payment for your {{packageName}} subscription could not be processed. Update the payment method in the billing console.\n\nWorkflow Execution Engine',
    variables: ['contactName', 'packageName'],
  },
};

const LIFECYCLE_TEMPLATES: Pick<
  Record<EmailTemplateKey, EmailTemplateSeed>,
  'TRIAL_ENDING' | 'USAGE_LIMIT_WARNING' | 'SUBSCRIPTION_RENEWAL'
> = {
  TRIAL_ENDING: {
    key: 'TRIAL_ENDING',
    name: 'Trial ending',
    subject: 'Your trial ends in {{daysRemaining}} days',
    html: layout('<p>Hi {{contactName}},</p><p>Your trial on <strong>{{packageName}}</strong> ends on {{trialEndsAt}} ({{daysRemaining}} days). Choose a plan in the billing console to keep metered features running.</p>'),
    text: 'Hi {{contactName}},\n\nYour trial on {{packageName}} ends on {{trialEndsAt}} ({{daysRemaining}} days).\n\nWorkflow Execution Engine',
    variables: ['contactName', 'packageName', 'trialEndsAt', 'daysRemaining'],
  },
  USAGE_LIMIT_WARNING: {
    key: 'USAGE_LIMIT_WARNING',
    name: 'Usage limit warning',
    subject: '{{metric}} usage is at {{percent}}% of your plan limit',
    html: layout('<p>Hi {{contactName}},</p><p><strong>{{metric}}</strong> usage for {{periodKey}} has reached {{percent}}% of the {{packageName}} plan limit ({{used}} of {{limit}}). Upgrade the plan or expect overage handling at the limit.</p>'),
    text: 'Hi {{contactName}},\n\n{{metric}} usage for {{periodKey}} reached {{percent}}% of the {{packageName}} limit ({{used}} of {{limit}}).\n\nWorkflow Execution Engine',
    variables: ['contactName', 'metric', 'periodKey', 'percent', 'packageName', 'used', 'limit'],
  },
  SUBSCRIPTION_RENEWAL: {
    key: 'SUBSCRIPTION_RENEWAL',
    name: 'Subscription renewal',
    subject: 'Your {{packageName}} subscription renewed',
    html: layout('<p>Hi {{contactName}},</p><p>Your <strong>{{packageName}}</strong> subscription renewed for the period ending {{periodEnd}}.</p>'),
    text: 'Hi {{contactName}},\n\nYour {{packageName}} subscription renewed for the period ending {{periodEnd}}.\n\nWorkflow Execution Engine',
    variables: ['contactName', 'packageName', 'periodEnd'],
  },
};

const AUTOMATION_TEMPLATES: Pick<
  Record<EmailTemplateKey, EmailTemplateSeed>,
  'TRIAL_STARTED' | 'UPGRADE_OPPORTUNITY' | 'INACTIVE_CUSTOMER'
> = {
  TRIAL_STARTED: {
    key: 'TRIAL_STARTED',
    name: 'Trial started',
    subject: 'Your {{packageName}} trial is running',
    html: layout('<p>Hi {{contactName}},</p><p>Your trial of <strong>{{packageName}}</strong> started today and runs until {{trialEndsAt}} ({{daysRemaining}} days). Everything in the package is unlocked - workflows, agents and analytics.</p>'),
    text: 'Hi {{contactName}},\n\nYour {{packageName}} trial runs until {{trialEndsAt}} ({{daysRemaining}} days).\n\nWorkflow Execution Engine',
    variables: ['contactName', 'packageName', 'trialEndsAt', 'daysRemaining'],
  },
  UPGRADE_OPPORTUNITY: {
    key: 'UPGRADE_OPPORTUNITY',
    name: 'Upgrade opportunity',
    subject: 'You have used {{percent}}% of your {{metric}} allowance',
    html: layout('<p>Hi {{contactName}},</p><p><strong>{{metric}}</strong> usage for {{periodKey}} is at {{percent}}% of the {{packageName}} allowance ({{used}} of {{limit}}). Moving to the next package raises the limit before the workload has to slow down.</p>'),
    text: 'Hi {{contactName}},\n\n{{metric}} usage for {{periodKey}} is at {{percent}}% of the {{packageName}} allowance ({{used}} of {{limit}}).\n\nWorkflow Execution Engine',
    variables: ['contactName', 'metric', 'percent', 'used', 'limit', 'packageName', 'periodKey'],
  },
  INACTIVE_CUSTOMER: {
    key: 'INACTIVE_CUSTOMER',
    name: 'Inactive customer',
    subject: 'We have not seen {{companyName}} activity for {{idleDays}} days',
    html: layout('<p>Hi {{contactName}},</p><p>Your workspace has not run an execution for {{idleDays}} days. If something is blocked, reply to this email and we will help you get the automation back on track.</p>'),
    text: 'Hi {{contactName}},\n\nYour workspace has not run an execution for {{idleDays}} days. Reply to this email if something is blocked and we will help.\n\nWorkflow Execution Engine',
    variables: ['contactName', 'companyName', 'idleDays'],
  },
};

export const DEFAULT_EMAIL_TEMPLATES: Record<EmailTemplateKey, EmailTemplateSeed> = {
  ...CORE_TEMPLATES,
  ...BILLING_TEMPLATES,
  ...LIFECYCLE_TEMPLATES,
  ...AUTOMATION_TEMPLATES,
};

/** Seed the registry on first use; existing copies are never overwritten. */
export async function ensureDefaultEmailTemplates(): Promise<void> {
  const existing = await EmailTemplateModel.find().select('key').lean();
  const present = new Set(existing.map((row) => row.key));
  const missing = Object.values(DEFAULT_EMAIL_TEMPLATES).filter((seed) => !present.has(seed.key));
  if (missing.length === 0) return;
  await EmailTemplateModel.insertMany(missing.map((seed) => ({ ...seed, version: 1, isActive: true })));
}

export type EmailTemplateRecord = Pick<IEmailTemplate, 'key' | 'subject' | 'html' | 'text' | 'variables'>;
