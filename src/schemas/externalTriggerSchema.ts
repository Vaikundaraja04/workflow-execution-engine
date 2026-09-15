import { z } from 'zod';

export const ExternalTriggerSchema = z.object({
  input: z.record(z.string(), z.json()).optional().default({}),
  idempotencyKey: z.string().trim().min(1).max(128),
}).strict();

export type ExternalTriggerInput = z.infer<typeof ExternalTriggerSchema>;
