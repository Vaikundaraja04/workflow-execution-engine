import { Types } from 'mongoose';
import { EmailTemplateModel } from '../../models/EmailTemplateModel.js';
import type { EmailTemplateKey } from '../../models/EmailTemplateModel.js';
import { NotificationLogModel } from '../../models/NotificationLogModel.js';
import type { NotificationStatus } from '../../models/NotificationLogModel.js';
import { createNotificationProvider } from './notificationProvider.js';
import { DEFAULT_EMAIL_TEMPLATES, ensureDefaultEmailTemplates } from './emailTemplates.js';
import { createAuditLog } from '../auditService.js';
import { CustomerProfileModel } from '../../models/CustomerProfileModel.js';
import { TenantAccountModel } from '../../models/TenantAccountModel.js';
import { UserModel } from '../../models/UserModel.js';

/**
 * Phase 15.6 - Email notification service.
 *
 * renderTemplate resolves the registry row (falling back to the built-in copy),
 * escapes every interpolated value and returns the finished message. sendEmail
 * delivers through the configured provider and records the attempt; queueEmail
 * persists the intent first so a provider outage leaves a retryable row rather
 * than a lost notification. Every outcome is audited (EMAIL_SENT / EMAIL_FAILED)
 * and no rendered body is ever stored.
 */

export type TemplateVariables = Record<string, string | number | null | undefined>;

export interface SendEmailInput {
  to: string;
  template: EmailTemplateKey;
  variables?: TemplateVariables | undefined;
  workspaceId?: string | null | undefined;
  userId?: string | null | undefined;
  actorUserId?: string | undefined;
  provider?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface EmailDeliveryResult {
  logId: string;
  status: NotificationStatus;
  provider: string;
  providerMessageId: string | null;
  subject: string;
  recipient: string;
  template: EmailTemplateKey;
}

const MAX_ATTEMPTS = 5;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Replace {{variable}} placeholders; missing values render as an empty string. */
export function interpolate(source: string, variables: TemplateVariables, escape: boolean): string {
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) => {
    const raw = variables[name];
    if (raw === undefined || raw === null) return '';
    const value = String(raw);
    return escape ? escapeHtml(value) : value;
  });
}

export class EmailNotificationService {
  /** Render a template from the registry (falling back to the built-in copy). */
  async renderTemplate(
    template: EmailTemplateKey,
    variables: TemplateVariables = {},
  ): Promise<{ subject: string; html: string; text: string }> {
    let record = await EmailTemplateModel.findOne({ key: template, isActive: true }).lean();
    if (!record) {
      await ensureDefaultEmailTemplates();
      record = await EmailTemplateModel.findOne({ key: template, isActive: true }).lean();
    }
    const fallback = DEFAULT_EMAIL_TEMPLATES[template];
    const source = record ?? fallback;
    if (!source) throw new Error('EMAIL_TEMPLATE_NOT_FOUND');

    return {
      subject: interpolate(source.subject, variables, false),
      html: interpolate(source.html, variables, true),
      text: interpolate(source.text, variables, false),
    };
  }

  /** Render, deliver and record one email. */
  async sendEmail(input: SendEmailInput): Promise<EmailDeliveryResult> {
    const variables = input.variables ?? {};
    const rendered = await this.renderTemplate(input.template, variables);
    const provider = createNotificationProvider(input.provider);

    const log = await NotificationLogModel.create({
      workspaceId: input.workspaceId ? new Types.ObjectId(input.workspaceId) : null,
      userId: input.userId ? new Types.ObjectId(input.userId) : null,
      channel: 'email',
      recipient: input.to.trim().toLowerCase(),
      template: input.template,
      subject: rendered.subject,
      provider: provider.name,
      status: 'QUEUED',
      attempts: 0,
      queuedAt: new Date(),
      metadata: { ...(input.metadata ?? {}), templateVariables: variables },
    });

    return this.deliver(log._id.toString(), rendered, provider.name, input);
  }

  /**
   * Persist the intent before delivering so a provider outage leaves a
   * retryable row (queueEmail then sends immediately when the provider is up).
   */
  async queueEmail(input: SendEmailInput): Promise<EmailDeliveryResult> {
    return this.sendEmail(input);
  }

  /** Retry failed notifications, re-rendering from the stored variables. */
  async retryFailedEmails(options: { limit?: number | undefined } = {}): Promise<{
    attempted: number;
    sent: number;
    failed: number;
  }> {
    const limit = typeof options.limit === 'number' && options.limit > 0 ? Math.min(200, Math.floor(options.limit)) : 50;
    const pending = await NotificationLogModel.find({
      status: { $in: ['FAILED', 'QUEUED'] },
      attempts: { $lt: MAX_ATTEMPTS },
    })
      .sort({ queuedAt: 1 })
      .limit(limit);

    let sent = 0;
    let failed = 0;
    for (const log of pending) {
      const metadata = (log.metadata ?? {}) as Record<string, unknown>;
      const variables = (metadata.templateVariables ?? {}) as TemplateVariables;
      let rendered: { subject: string; html: string; text: string };
      try {
        rendered = await this.renderTemplate(log.template, variables);
      } catch {
        failed += 1;
        log.status = 'FAILED';
        log.error = 'EMAIL_TEMPLATE_NOT_FOUND';
        log.attempts += 1;
        await log.save();
        continue;
      }
      const result = await this.deliver(log._id.toString(), rendered, log.provider, {
        to: log.recipient,
        template: log.template,
        workspaceId: log.workspaceId ? log.workspaceId.toString() : null,
        userId: log.userId ? log.userId.toString() : null,
      });
      if (result.status === 'SENT') sent += 1;
      else failed += 1;
    }

    return { attempted: pending.length, sent, failed };
  }

  /**
   * Never-throwing send for product flows: a notification failure must not break
   * a signup, a checkout or a webhook.
   */
  async sendSafely(input: SendEmailInput): Promise<EmailDeliveryResult | null> {
    try {
      return await this.sendEmail(input);
    } catch {
      return null;
    }
  }

  /** Billing contact if recorded, otherwise the workspace owner's address. */
  async resolveWorkspaceRecipient(workspaceId: string): Promise<string | null> {
    const workspaceIdObj = new Types.ObjectId(workspaceId);
    const profile = await CustomerProfileModel.findOne({ tenantId: workspaceIdObj })
      .select('contactEmail')
      .lean();
    if (profile?.contactEmail) return profile.contactEmail;

    const tenant = await TenantAccountModel.findOne({ workspaceId: workspaceIdObj })
      .select('ownerUserId')
      .lean();
    if (!tenant) return null;
    const owner = await UserModel.findById(tenant.ownerUserId).select('email').lean();
    return owner?.email ?? null;
  }

  /** Delivery log for operators (newest first). */
  async listNotifications(options: { status?: NotificationStatus | undefined; limit?: number | undefined } = {}) {
    const limit = typeof options.limit === 'number' && options.limit > 0 ? Math.min(200, Math.floor(options.limit)) : 50;
    const query: Record<string, unknown> = {};
    if (options.status) query.status = options.status;
    return NotificationLogModel.find(query).sort({ createdAt: -1 }).limit(limit).lean();
  }

  /** Deliver + record one message. Never throws on provider failure. */
  private async deliver(
    logId: string,
    rendered: { subject: string; html: string; text: string },
    providerName: string,
    input: SendEmailInput,
  ): Promise<EmailDeliveryResult> {
    const provider = createNotificationProvider(providerName);
    try {
      const result = await provider.send({
        to: input.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        template: input.template,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      });
      await NotificationLogModel.updateOne(
        { _id: new Types.ObjectId(logId) },
        {
          $set: {
            status: 'SENT',
            provider: result.provider,
            providerMessageId: result.providerMessageId,
            sentAt: new Date(),
            error: null,
          },
          $inc: { attempts: 1 },
        },
      );
      await createAuditLog({
        action: 'EMAIL_SENT',
        ...(input.actorUserId !== undefined ? { userId: input.actorUserId } : {}),
        ...(input.workspaceId ? { workspaceId: new Types.ObjectId(input.workspaceId) } : {}),
        resource: 'notification',
        resourceId: logId,
        metadata: { template: input.template, recipient: input.to, provider: result.provider },
      });
      return {
        logId,
        status: 'SENT',
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        subject: rendered.subject,
        recipient: input.to,
        template: input.template,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'EMAIL_SEND_FAILED';
      await NotificationLogModel.updateOne(
        { _id: new Types.ObjectId(logId) },
        { $set: { status: 'FAILED', error: message.slice(0, 500) }, $inc: { attempts: 1 } },
      );
      await createAuditLog({
        action: 'EMAIL_FAILED',
        ...(input.actorUserId !== undefined ? { userId: input.actorUserId } : {}),
        ...(input.workspaceId ? { workspaceId: new Types.ObjectId(input.workspaceId) } : {}),
        resource: 'notification',
        resourceId: logId,
        metadata: { template: input.template, recipient: input.to, provider: providerName, error: message },
      });
      return {
        logId,
        status: 'FAILED',
        provider: providerName,
        providerMessageId: null,
        subject: rendered.subject,
        recipient: input.to,
        template: input.template,
      };
    }
  }
}

export const emailNotificationService = new EmailNotificationService();
