import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { WebhookModel } from '../models/WebhookModel.js';
import type { IWebhook, WebhookEvent, WebhookStatus } from '../models/WebhookModel.js';
import { WebhookDeliveryModel } from '../models/WebhookDeliveryModel.js';
import type { IWebhookDelivery, WebhookDeliveryStatus } from '../models/WebhookDeliveryModel.js';
import { createAuditLog } from './auditService.js';

interface EncryptionResult {
  encryptedData: string;
  iv: string;
  tag: string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM

function getEncryptionKey(): Buffer {
  const secret = process.env.WEBHOOK_SECRET_KEY || 'default-secret-key-32-chars-long!!';
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(plaintext: string): EncryptionResult {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encryptedData: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptSecret(encryptedData: string, iv: string, tag: string): string {
  const key = getEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(encryptedData, 'base64'),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function signPayload(rawPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(rawPayload).digest('hex');
}

export async function createWebhook(
  workspaceId: string,
  userId: string,
  input: {
    name: string;
    url: string;
    events: WebhookEvent[];
    status?: WebhookStatus;
  },
): Promise<{ webhook: IWebhook; secret: string }> {
  // Validate HTTPS URL
  if (!input.url.toLowerCase().startsWith('https://')) {
    throw new Error('WEBHOOK_URL_MUST_BE_HTTPS');
  }

  // Validate events are not empty
  if (!input.events || input.events.length === 0) {
    throw new Error('WEBHOOK_EVENTS_REQUIRED');
  }

  // Validate all events are valid
  for (const event of input.events) {
    if (!['WORKFLOW_EXECUTION_STARTED', 'WORKFLOW_EXECUTION_COMPLETED', 'WORKFLOW_EXECUTION_FAILED', 'WORKFLOW_EXECUTION_REPLAYED'].includes(event)) {
      throw new Error('INVALID_WEBHOOK_EVENT');
    }
  }

  // Generate secret for signing
  const secret = randomBytes(32).toString('hex');
  const { encryptedData, iv, tag } = encryptSecret(secret);
  const encryptedSecret = `${encryptedData}.${iv}.${tag}`;

  const webhook = await WebhookModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    name: input.name.trim(),
    url: input.url,
    events: input.events,
    encryptedSecret,
    status: input.status ?? 'ACTIVE',
    createdBy: new Types.ObjectId(userId),
  });

  await createAuditLog({
    action: 'WEBHOOK_CREATED',
    userId,
    workspaceId,
    resource: 'webhook',
    resourceId: webhook._id.toString(),
    metadata: {
      webhookId: webhook._id.toString(),
      name: input.name,
      url: input.url,
      events: input.events,
      status: webhook.status,
    },
  });

  return { webhook, secret };
}

export async function listWebhooks(workspaceId: string): Promise<IWebhook[]> {
  return WebhookModel.find({
    workspaceId: new Types.ObjectId(workspaceId),
  }).sort({ createdAt: -1 });
}

export async function getWebhook(id: string, workspaceId: string): Promise<IWebhook> {
  if (!Types.ObjectId.isValid(id)) {
    throw new Error('INVALID_WEBHOOK_ID');
  }

  const webhook = await WebhookModel.findOne({
    _id: new Types.ObjectId(id),
    workspaceId: new Types.ObjectId(workspaceId),
  });

  if (!webhook) {
    throw new Error('WEBHOOK_NOT_FOUND');
  }

  return webhook;
}

export async function updateWebhook(
  id: string,
  workspaceId: string,
  userId: string,
  updates: {
    name?: string | undefined;
    url?: string | undefined;
    events?: WebhookEvent[] | undefined;
    status?: WebhookStatus | undefined;
  },
): Promise<IWebhook> {
  if (!Types.ObjectId.isValid(id)) {
    throw new Error('INVALID_WEBHOOK_ID');
  }

  const webhook = await WebhookModel.findOne({
    _id: new Types.ObjectId(id),
    workspaceId: new Types.ObjectId(workspaceId),
  });

  if (!webhook) {
    throw new Error('WEBHOOK_NOT_FOUND');
  }

  // Validate URL if provided
  if (updates.url !== undefined && !updates.url.toLowerCase().startsWith('https://')) {
    throw new Error('WEBHOOK_URL_MUST_BE_HTTPS');
  }

  // Validate events if provided
  if (updates.events !== undefined) {
    if (!updates.events || updates.events.length === 0) {
      throw new Error('WEBHOOK_EVENTS_REQUIRED');
    }

    for (const event of updates.events) {
      if (!['WORKFLOW_EXECUTION_STARTED', 'WORKFLOW_EXECUTION_COMPLETED', 'WORKFLOW_EXECUTION_FAILED', 'WORKFLOW_EXECUTION_REPLAYED'].includes(event)) {
        throw new Error('INVALID_WEBHOOK_EVENT');
      }
    }
  }

  const updateData: Record<string, unknown> = {};
  if (updates.name !== undefined) {
    updateData.name = updates.name.trim();
  }
  if (updates.url !== undefined) {
    updateData.url = updates.url;
  }
  if (updates.events !== undefined) {
    updateData.events = updates.events;
  }
  if (updates.status !== undefined) {
    updateData.status = updates.status;
  }

  const updatedWebhook = await WebhookModel.findOneAndUpdate(
    { _id: new Types.ObjectId(id), workspaceId: new Types.ObjectId(workspaceId) },
    { $set: updateData },
    { returnDocument: 'after' },
  );

  if (!updatedWebhook) {
    throw new Error('WEBHOOK_NOT_FOUND');
  }

  await createAuditLog({
    action: 'WEBHOOK_UPDATED',
    userId,
    workspaceId,
    resource: 'webhook',
    resourceId: updatedWebhook._id.toString(),
    metadata: {
      webhookId: updatedWebhook._id.toString(),
      name: updates.name,
      url: updates.url,
      events: updates.events,
      status: updates.status,
    },
  });

  return updatedWebhook;
}

export async function deleteWebhook(id: string, workspaceId: string, userId: string): Promise<void> {
  if (!Types.ObjectId.isValid(id)) {
    throw new Error('INVALID_WEBHOOK_ID');
  }

  const webhook = await WebhookModel.findOneAndUpdate(
    { _id: new Types.ObjectId(id), workspaceId: new Types.ObjectId(workspaceId) },
    { $set: { status: 'DISABLED' } },
    { returnDocument: 'after' },
  );

  if (!webhook) {
    throw new Error('WEBHOOK_NOT_FOUND');
  }

  await createAuditLog({
    action: 'WEBHOOK_DELETED',
    userId,
    workspaceId,
    resource: 'webhook',
    resourceId: webhook._id.toString(),
    metadata: {
      webhookId: webhook._id.toString(),
    },
  });
}

export async function getWebhookSecret(id: string, workspaceId: string): Promise<string> {
  const webhook = await getWebhook(id, workspaceId);

  // Decrypt the secret: format is encryptedData.iv.tag
  const [encryptedData, iv, tag] = webhook.encryptedSecret.split('.');
  if (!encryptedData || !iv || !tag) {
    throw new Error('WEBHOOK_SECRET_CORRUPTED');
  }

  return decryptSecret(encryptedData, iv, tag);
}

export async function createWebhookDelivery(
  webhookId: string,
  workspaceId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<IWebhookDelivery> {
  const delivery = await WebhookDeliveryModel.create({
    webhookId: new Types.ObjectId(webhookId),
    workspaceId: new Types.ObjectId(workspaceId),
    event,
    payload: JSON.stringify(payload),
    status: 'PENDING',
    attempts: 0,
    maxAttempts: 5,
  });

  return delivery;
}

export async function getWebhookDeliveryById(id: string): Promise<IWebhookDelivery> {
  if (!Types.ObjectId.isValid(id)) {
    throw new Error('INVALID_WEBHOOK_DELIVERY_ID');
  }

  const delivery = await WebhookDeliveryModel.findOne({
    _id: new Types.ObjectId(id),
  });

  if (!delivery) {
    throw new Error('WEBHOOK_DELIVERY_NOT_FOUND');
  }

  return delivery;
}

export async function getWebhookDelivery(id: string, workspaceId: string): Promise<IWebhookDelivery> {
  if (!Types.ObjectId.isValid(id)) {
    throw new Error('INVALID_WEBHOOK_DELIVERY_ID');
  }

  const delivery = await WebhookDeliveryModel.findOne({
    _id: new Types.ObjectId(id),
    workspaceId: new Types.ObjectId(workspaceId),
  });

  if (!delivery) {
    throw new Error('WEBHOOK_DELIVERY_NOT_FOUND');
  }

  return delivery;
}

export async function listWebhookDeliveries(
  webhookId: string,
  workspaceId: string,
  options: {
    limit?: number;
    offset?: number;
    status?: WebhookDeliveryStatus;
  } = {},
): Promise<IWebhookDelivery[]> {
  if (!Types.ObjectId.isValid(webhookId)) {
    throw new Error('INVALID_WEBHOOK_ID');
  }

  const query: Record<string, unknown> = {
    webhookId: new Types.ObjectId(webhookId),
    workspaceId: new Types.ObjectId(workspaceId),
  };

  if (options.status) {
    query.status = options.status;
  }

  const deliveries = await WebhookDeliveryModel.find(query)
    .sort({ createdAt: -1 })
    .skip(options.offset ?? 0)
    .limit(options.limit ?? 100);

  return deliveries;
}

export async function updateWebhookDeliveryStatus(
  id: string,
  workspaceId: string,
  update: {
    status?: WebhookDeliveryStatus | undefined;
    attempts?: number | undefined;
    nextRetryAt?: Date | null | undefined;
    responseCode?: number | undefined;
    responseBody?: string | undefined;
    durationMs?: number | undefined;
    deliveredAt?: Date | undefined;
  },
): Promise<IWebhookDelivery> {
  if (!Types.ObjectId.isValid(id)) {
    throw new Error('INVALID_WEBHOOK_DELIVERY_ID');
  }

  const updateData: Record<string, unknown> = {};
  if (update.status !== undefined) {
    updateData.status = update.status;
  }
  if (update.attempts !== undefined) {
    updateData.attempts = update.attempts;
  }
  if (update.nextRetryAt !== undefined) {
    updateData.nextRetryAt = update.nextRetryAt;
  }
  if (update.responseCode !== undefined) {
    updateData.responseCode = update.responseCode;
  }
  if (update.responseBody !== undefined) {
    updateData.responseBody = update.responseBody;
  }
  if (update.durationMs !== undefined) {
    updateData.durationMs = update.durationMs;
  }
  if (update.deliveredAt !== undefined) {
    updateData.deliveredAt = update.deliveredAt;
  }

  const delivery = await WebhookDeliveryModel.findOneAndUpdate(
    { _id: new Types.ObjectId(id), workspaceId: new Types.ObjectId(workspaceId) },
    { $set: updateData },
    { returnDocument: 'after' },
  );

  if (!delivery) {
    throw new Error('WEBHOOK_DELIVERY_NOT_FOUND');
  }

  return delivery;
}
