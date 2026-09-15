import { z } from 'zod';
import { PERMISSIONS } from '../auth/permissions.js';

export const CreateAPIKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  permissions: z.array(z.enum(PERMISSIONS)).optional().default([]),
  expiresAt: z.string().datetime().optional(),
}).strict();

export const UpdateAPIKeySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  permissions: z.array(z.enum(PERMISSIONS)).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict().refine(data => Object.keys(data).length > 0, {
  message: 'At least one field is required',
});

export type CreateAPIKeyInput = z.infer<typeof CreateAPIKeySchema>;
export type UpdateAPIKeyInput = z.infer<typeof UpdateAPIKeySchema>;
