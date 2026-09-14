import { z } from 'zod';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

const envSchema = z.object({
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),
  PORT: z.coerce.number().int().positive().default(3000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(100).default(5),
  EXECUTION_ATTEMPTS: z.coerce.number().int().positive().max(20).default(3),
  EXECUTION_BACKOFF_MS: z.coerce.number().int().positive().default(1000),
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
