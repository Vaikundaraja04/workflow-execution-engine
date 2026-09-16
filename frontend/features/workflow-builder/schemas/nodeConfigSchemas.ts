import { z } from 'zod';

export const webhookTriggerSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT']),
  path: z.string().trim().optional(),
  authRequired: z.boolean(),
});

export const manualTriggerSchema = z.object({
  description: z.string().trim().optional(),
  inputSchema: z.string().trim().optional(),
});

export const scheduleTriggerSchema = z.object({
  cronExpression: z.string().trim().min(1, 'Cron expression is required'),
  timezone: z.string().trim(),
});

export const httpRequestConfigSchema = z.object({
  url: z.string().trim().min(1, 'URL is required').url('Must be a valid URL'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  headers: z.string().trim().optional(),
  body: z.string().trim().optional(),
  timeoutMs: z.number().min(100).max(60000),
  retryCount: z.number().min(0).max(5),
});

export const emailConfigSchema = z.object({
  recipient: z.string().trim().min(1, 'Recipient email is required').email('Invalid email address'),
  subject: z.string().trim().min(1, 'Subject is required'),
  message: z.string().trim().min(1, 'Message body is required'),
});

export const databaseQueryConfigSchema = z.object({
  database: z.string().trim().optional(),
  query: z.string().trim().min(1, 'Query is required'),
  parameters: z.string().trim().optional(),
});

export const notificationConfigSchema = z.object({
  channel: z.enum(['slack', 'email', 'in_app', 'webhook']),
  recipient: z.string().trim().optional(),
  message: z.string().trim().min(1, 'Notification message is required'),
  level: z.enum(['info', 'warning', 'error']),
});

export const conditionConfigSchema = z.object({
  field: z.string().trim().min(1, 'Field name is required'),
  operator: z.enum(['equals', 'notEquals', 'greaterThan', 'lessThan']),
  value: z.any().refine((val) => val !== undefined && val !== '', {
    message: 'Comparison value is required',
  }),
});

export const delayConfigSchema = z.object({
  durationSeconds: z.number().min(1, 'Duration must be at least 1 second').max(86400, 'Max delay is 24 hours'),
  mode: z.enum(['fixed', 'dynamic']),
});

export const logConfigSchema = z.object({
  message: z.string().trim().min(1, 'Log message is required'),
  level: z.enum(['debug', 'info', 'warn', 'error']),
});

export const workflowMetadataSchema = z.object({
  name: z.string().trim().min(1, 'Workflow name is required').max(120),
  description: z.string().trim().max(500).optional(),
});

export type WebhookTriggerFormValues = z.infer<typeof webhookTriggerSchema>;
export type ManualTriggerFormValues = z.infer<typeof manualTriggerSchema>;
export type ScheduleTriggerFormValues = z.infer<typeof scheduleTriggerSchema>;
export type HttpRequestFormValues = z.infer<typeof httpRequestConfigSchema>;
export type EmailFormValues = z.infer<typeof emailConfigSchema>;
export type DatabaseQueryFormValues = z.infer<typeof databaseQueryConfigSchema>;
export type NotificationFormValues = z.infer<typeof notificationConfigSchema>;
export type ConditionFormValues = z.infer<typeof conditionConfigSchema>;
export type DelayFormValues = z.infer<typeof delayConfigSchema>;
export type LogFormValues = z.infer<typeof logConfigSchema>;
export type WorkflowMetadataFormValues = z.infer<typeof workflowMetadataSchema>;