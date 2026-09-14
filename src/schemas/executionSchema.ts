import { z } from 'zod';

export const CreateExecutionRequestSchema = z.object({
  input: z.record(z.string(), z.json()).optional().default({}),
  idempotencyKey: z.string().trim().min(1).max(128),
}).strict();

export type CreateExecutionRequest = z.infer<typeof CreateExecutionRequestSchema>;
