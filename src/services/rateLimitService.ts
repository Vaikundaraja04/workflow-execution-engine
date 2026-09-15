import { Redis } from 'ioredis';
import { APIKeyModel } from '../models/APIKeyModel.js';

export interface RateLimitCheckResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number; // Unix timestamp in milliseconds
  retryAfter: number; // Seconds until reset
}

export const DEFAULT_API_KEY_LIMIT = 1000; // requests per minute
export const DEFAULT_WORKSPACE_LIMIT = 5000; // requests per hour
export const API_KEY_WINDOW_SECONDS = 60; // 1 minute
export const WORKSPACE_WINDOW_SECONDS = 3600; // 1 hour

export class RateLimitService {
  private client: Redis;

  constructor(redisOrUrl?: Redis | string) {
    if (redisOrUrl instanceof Redis) {
      this.client = redisOrUrl;
    } else {
      const url = typeof redisOrUrl === 'string' ? redisOrUrl : (process.env.REDIS_URL || 'redis://127.0.0.1:6379');
      this.client = new Redis(url, {
        maxRetriesPerRequest: 3,
        enableOfflineQueue: true,
        lazyConnect: false,
        retryStrategy: (times) => (times > 3 ? null : Math.min(times * 100, 1000)),
      });

      this.client.on('error', (err) => {
        // Suppress unhandled redis errors during disconnection
      });
    }
  }

  /**
   * Get window start for a given window size in seconds
   */
  public getWindowStart(windowSeconds: number, nowSeconds = Math.floor(Date.now() / 1000)): number {
    return Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  }

  /**
   * Calculate remaining requests given limit and current count
   */
  public calculateRemaining(limit: number, requestCount: number): number {
    return Math.max(0, limit - requestCount);
  }

  /**
   * Calculate reset time in milliseconds given windowStart and windowSeconds
   */
  public calculateResetTime(windowStart: number, windowSeconds: number): number {
    return (windowStart + windowSeconds) * 1000;
  }

  /**
   * Check and increment API Key rate limit atomically using Redis INCR & EXPIRE
   */
  public async checkApiKeyLimit(
    apiKeyId: string,
    customLimit?: number,
    windowSeconds = API_KEY_WINDOW_SECONDS,
  ): Promise<RateLimitCheckResult> {
    const limit = customLimit && customLimit > 0 ? customLimit : DEFAULT_API_KEY_LIMIT;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowStart = this.getWindowStart(windowSeconds, nowSeconds);
    const key = `ratelimit:apikey:${apiKeyId}:${windowStart}`;

    return this.incrementAndCheck(key, limit, windowStart, windowSeconds, nowSeconds);
  }

  /**
   * Check and increment Workspace rate limit atomically using Redis INCR & EXPIRE
   */
  public async checkWorkspaceLimit(
    workspaceId: string,
    customLimit?: number,
    windowSeconds = WORKSPACE_WINDOW_SECONDS,
  ): Promise<RateLimitCheckResult> {
    const limit = customLimit && customLimit > 0 ? customLimit : DEFAULT_WORKSPACE_LIMIT;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowStart = this.getWindowStart(windowSeconds, nowSeconds);
    const key = `ratelimit:workspace:${workspaceId}:${windowStart}`;

    return this.incrementAndCheck(key, limit, windowStart, windowSeconds, nowSeconds);
  }

  /**
   * Atomic increment and expiration helper
   */
  private async incrementAndCheck(
    key: string,
    limit: number,
    windowStart: number,
    windowSeconds: number,
    nowSeconds: number,
  ): Promise<RateLimitCheckResult> {
    const resetTime = this.calculateResetTime(windowStart, windowSeconds);
    const retryAfter = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));

    try {
      const pipeline = this.client.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, windowSeconds * 2);
      const results = await pipeline.exec();

      if (!results || !results[0]) {
        throw new Error('Redis pipeline execution failed');
      }

      const [incrErr, countValue] = results[0];
      if (incrErr) throw incrErr;

      const requestCount = typeof countValue === 'number' ? countValue : parseInt(String(countValue), 10);
      const remaining = this.calculateRemaining(limit, requestCount);
      const allowed = requestCount <= limit;

      return {
        allowed,
        limit,
        remaining,
        resetTime,
        retryAfter,
      };
    } catch (err) {
      // Fail open if Redis is unreachable
      return {
        allowed: true,
        limit,
        remaining: limit,
        resetTime,
        retryAfter,
      };
    }
  }

  /**
   * Check limit for an API Key by retrieving its configured rateLimit from MongoDB,
   * then evaluating both API Key per-minute limit and workspace per-hour limit.
   */
  public async checkLimits(
    apiKeyId: string,
    workspaceId: string,
  ): Promise<{
    allowed: boolean;
    apiKeyResult: RateLimitCheckResult;
    workspaceResult: RateLimitCheckResult;
  }> {
    let apiKeyRpm = DEFAULT_API_KEY_LIMIT;
    let apiKeyEph = DEFAULT_WORKSPACE_LIMIT;

    const apiKeyDoc = await APIKeyModel.findById(apiKeyId).select('rateLimit').lean();
    if (apiKeyDoc?.rateLimit) {
      if (apiKeyDoc.rateLimit.requestsPerMinute) {
        apiKeyRpm = apiKeyDoc.rateLimit.requestsPerMinute;
      }
      if (apiKeyDoc.rateLimit.executionsPerHour) {
        apiKeyEph = apiKeyDoc.rateLimit.executionsPerHour;
      }
    }

    const apiKeyResult = await this.checkApiKeyLimit(apiKeyId, apiKeyRpm, API_KEY_WINDOW_SECONDS);
    const workspaceResult = await this.checkWorkspaceLimit(workspaceId, apiKeyEph, WORKSPACE_WINDOW_SECONDS);

    const allowed = apiKeyResult.allowed && workspaceResult.allowed;

    return {
      allowed,
      apiKeyResult,
      workspaceResult,
    };
  }

  public async close(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      // Ignore cleanup error
    }
  }
}

let defaultRateLimitService: RateLimitService | null = null;

export function getRateLimitService(redisOrUrl?: Redis | string): RateLimitService {
  if (redisOrUrl) {
    return new RateLimitService(redisOrUrl);
  }
  if (!defaultRateLimitService) {
    defaultRateLimitService = new RateLimitService();
  }
  return defaultRateLimitService;
}

export function resetDefaultRateLimitService(): void {
  if (defaultRateLimitService) {
    defaultRateLimitService.close().catch(() => {});
    defaultRateLimitService = null;
  }
}
