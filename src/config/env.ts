import { z } from 'zod';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

const envSchema = z.object({
  MONGODB_URI: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  if (existsSync('.env')) {
    loadEnvFile('.env');
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}
