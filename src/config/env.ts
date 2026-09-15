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
  EXECUTION_TIMEOUT_MS: z.coerce.number().int().positive().max(3600000).default(30000),
  CORS_ORIGINS: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().max(100_000).default(1000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  AUTH_JWT_SECRET: z.string().min(32),
  AUTH_ACCESS_TTL: z.string().regex(/^\d+[smhd]$/).default('15m'),
  AUTH_REFRESH_TTL: z.string().regex(/^\d+[smhd]$/).default('30d'),
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
