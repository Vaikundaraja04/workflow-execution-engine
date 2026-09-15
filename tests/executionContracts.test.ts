import { describe, expect, it } from 'vitest';
import {
  CreateExecutionRequestSchema,
  ExecutionRetryPolicySchema,
} from '../src/schemas/executionSchema.js';
import {
  MAX_EXECUTION_ATTEMPTS,
  MAX_RETRY_DELAY_MS,
  policyOf,
  resolveRetryPolicy,
  retryDelayMs,
} from '../src/services/executionService.js';
import {
  createExecutionJobId,
  UnavailableExecutionQueue,
} from '../src/queues/executionQueue.js';
import { hashExecutionInput } from '../src/services/executionService.js';

describe('Phase 2C execution contracts', () => {
  it('accepts a strict execution request and defaults input', () => {
    const parsed = CreateExecutionRequestSchema.parse({ idempotencyKey: 'booking-123' });
    expect(parsed).toEqual({ idempotencyKey: 'booking-123', input: {} });
  });

  it('rejects unknown request fields', () => {
    const parsed = CreateExecutionRequestSchema.safeParse({
      idempotencyKey: 'booking-123',
      unexpected: true,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects non-JSON input values', () => {
    const parsed = CreateExecutionRequestSchema.safeParse({
      idempotencyKey: 'booking-123',
      input: { invalid: undefined },
    });
    expect(parsed.success).toBe(false);
  });

  it('hashes equivalent JSON objects deterministically', () => {
    const first = hashExecutionInput({
      booking: { estimatedCost: 15_000, labels: ['priority', 'new'] },
      customerId: 'c-1',
    });
    const second = hashExecutionInput({
      customerId: 'c-1',
      booking: { labels: ['priority', 'new'], estimatedCost: 15_000 },
    });
    expect(first).toBe(second);
  });

  it('produces different hashes for different input', () => {
    expect(hashExecutionInput({ estimatedCost: 15_000 }))
      .not.toBe(hashExecutionInput({ estimatedCost: 5_000 }));
  });

  it('creates a BullMQ-safe deterministic job ID', () => {
    const id = '507f1f77bcf86cd799439011';
    expect(createExecutionJobId(id)).toBe(`execution-${id}`);
    expect(createExecutionJobId(id)).not.toContain(':');
  });

  it('fails explicitly when no execution queue is configured', async () => {
    const queue = new UnavailableExecutionQueue();
    await expect(queue.enqueue(
      { executionId: '507f1f77bcf86cd799439011' },
      { jobId: 'job-1', attempts: 3, backoffMs: 100 },
    )).rejects.toThrow('QUEUE_UNAVAILABLE');
  });
});

describe('Phase 2E retry policy contracts', () => {
  it('accepts a fixed retry policy with a bounded timeout', () => {
    const parsed = CreateExecutionRequestSchema.parse({
      idempotencyKey: 'booking-123',
      retryPolicy: { type: 'FIXED', delayMs: 500, maxRetries: 2 },
      timeoutMs: 30_000,
    });
    expect(parsed.retryPolicy).toEqual({ type: 'FIXED', delayMs: 500, maxRetries: 2 });
    expect(parsed.timeoutMs).toBe(30_000);
  });

  it('rejects retry policies with unknown or out-of-range values', () => {
    expect(ExecutionRetryPolicySchema.safeParse({ type: 'FIXED', delayMs: 100, unexpected: true }).success).toBe(false);
    expect(ExecutionRetryPolicySchema.safeParse({ type: 'FIXED', delayMs: 100, maxRetries: 20 }).success).toBe(false);
    expect(ExecutionRetryPolicySchema.safeParse({ type: 'EXPONENTIAL', delayMs: 100, backoffFactor: 0.5 }).success).toBe(false);
  });

  it('rejects a non-positive timeout', () => {
    expect(CreateExecutionRequestSchema.safeParse({ idempotencyKey: 'k', timeoutMs: 0 }).success).toBe(false);
  });

  it('defaults to exponential backoff with doubling delays', () => {
    const { policy, maxRetries } = resolveRetryPolicy(
      { idempotencyKey: 'k', input: {} },
      { attempts: 3, backoffMs: 250 },
    );
    expect(policy).toEqual({ type: 'EXPONENTIAL', delayMs: 250, backoffFactor: 2 });
    expect(maxRetries).toBe(2);
    expect(retryDelayMs(policy, 1)).toBe(250);
    expect(retryDelayMs(policy, 2)).toBe(500);
    expect(retryDelayMs(policy, 3)).toBe(1_000);
  });
  it('caps retries at the attempt budget', () => {
    const { policy, maxRetries } = resolveRetryPolicy(
      { idempotencyKey: 'k', input: {}, retryPolicy: { type: 'FIXED', delayMs: 100, maxRetries: 19 } },
      { attempts: 3 },
    );
    expect(maxRetries).toBe(2);
    expect(policy).toEqual({ type: 'FIXED', delayMs: 100 });
  });

  it('honors a retry budget below the attempt cap', () => {
    const { maxRetries } = resolveRetryPolicy(
      { idempotencyKey: 'k', input: {}, retryPolicy: { type: 'FIXED', delayMs: 100, maxRetries: 1 } },
      { attempts: MAX_EXECUTION_ATTEMPTS },
    );
    expect(maxRetries).toBe(1);
  });

  it('clamps exponentially growing delays', () => {
    const policy = { type: 'EXPONENTIAL' as const, delayMs: 3_600_000, backoffFactor: 10 };
    expect(retryDelayMs(policy, 2)).toBe(MAX_RETRY_DELAY_MS);
    expect(retryDelayMs(policy, 10)).toBe(MAX_RETRY_DELAY_MS);
  });

  it('normalizes missing and legacy policies', () => {
    expect(policyOf({})).toEqual({ type: 'EXPONENTIAL', delayMs: 1_000, backoffFactor: 2 });
    expect(policyOf({ retryPolicy: { type: 'FIXED', delayMs: 400, backoffFactor: 5 } }))
      .toEqual({ type: 'FIXED', delayMs: 400 });
  });
});