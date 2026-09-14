import { describe, expect, it } from 'vitest';
import { CreateExecutionRequestSchema } from '../src/schemas/executionSchema.js';
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
