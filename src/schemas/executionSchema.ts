import { z } from 'zod';

export const ExecutionRetryPolicySchema = z.object({
  type: z.enum(['FIXED', 'EXPONENTIAL']),
  delayMs: z.number().int().min(0).max(3_600_000),
  backoffFactor: z.number().min(1).max(10).optional(),
  maxRetries: z.number().int().min(0).max(19).optional(),
}).strict();

export const CreateExecutionRequestSchema = z.object({
  input: z.record(z.string(), z.json()).optional().default({}),
  idempotencyKey: z.string().trim().min(1).max(128),
  retryPolicy: ExecutionRetryPolicySchema.optional(),
  timeoutMs: z.number().int().positive().max(3_600_000).optional(),
}).strict();

export type CreateExecutionRequest = z.infer<typeof CreateExecutionRequestSchema>;
export type ExecutionRetryPolicyInput = z.infer<typeof ExecutionRetryPolicySchema>;
