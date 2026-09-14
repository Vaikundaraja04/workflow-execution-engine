import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RedisMemoryServer } from 'redis-memory-server';
import { BullMqExecutionQueue } from '../src/queues/bullMqExecutionQueue.js';
import type { ExecutionQueue } from '../src/queues/executionQueue.js';
import {
  createExecutionJobId,
} from '../src/queues/executionQueue.js';
import { createExecutionWorker } from '../src/workers/executionWorker.js';

let redisServer: RedisMemoryServer;
let redisUrl: string;
const queues: ExecutionQueue[] = [];
const workers: Array<ReturnType<typeof createExecutionWorker>> = [];

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for queue work');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function createQueue(): { queue: BullMqExecutionQueue; queueName: string } {
  const queueName = `execution-test-${randomUUID()}`;
  const queue = new BullMqExecutionQueue(redisUrl, queueName);
  queues.push(queue);
  return { queue, queueName };
}

beforeAll(async () => {
  redisServer = await RedisMemoryServer.create();
  redisUrl = `redis://${await redisServer.getHost()}:${await redisServer.getPort()}`;
}, 60_000);

afterEach(async () => {
  await Promise.all(workers.splice(0).map(worker => worker.close()));
  await Promise.all(queues.splice(0).map(queue => queue.close()));
});

afterAll(async () => {
  if (redisServer) await redisServer.stop();
});

describe('Phase 2C BullMQ integration', () => {
  it('keeps a queued job until a worker starts', async () => {
    const { queue, queueName } = createQueue();
    await queue.waitUntilReady();
    const attempts: number[] = [];
    const executionId = '507f1f77bcf86cd799439011';

    await queue.enqueue(
      { executionId },
      { jobId: createExecutionJobId(executionId), attempts: 3, backoffMs: 10 },
    );

    const worker = createExecutionWorker(redisUrl, {
      queueName,
      attemptRunner: async (_id, attemptNumber) => {
        attempts.push(attemptNumber);
      },
    });
    workers.push(worker);

    await waitFor(() => attempts.length >= 1);
    expect(attempts[0]).toBe(1);
  });

  it('retries failed work with the configured backoff', async () => {
    const { queue, queueName } = createQueue();
    await queue.waitUntilReady();
    const attempts: number[] = [];
    const executionId = '507f1f77bcf86cd799439012';

    const worker = createExecutionWorker(redisUrl, {
      queueName,
      attemptRunner: async (_id, attemptNumber) => {
        attempts.push(attemptNumber);
        if (attemptNumber < 3) throw new Error('transient');
      },
    });
    workers.push(worker);
    await worker.waitUntilReady();

    await queue.enqueue(
      { executionId },
      { jobId: createExecutionJobId(executionId), attempts: 3, backoffMs: 10 },
    );

    await waitFor(() => attempts.length === 3);
    expect(attempts).toEqual([1, 2, 3]);
  });

  it('does not add the same deterministic job twice', async () => {
    const { queue, queueName } = createQueue();
    await queue.waitUntilReady();
    const processed: string[] = [];
    const executionId = '507f1f77bcf86cd799439013';
    const jobId = createExecutionJobId(executionId);

    const worker = createExecutionWorker(redisUrl, {
      queueName,
      attemptRunner: async id => {
        processed.push(id);
      },
    });
    workers.push(worker);
    await worker.waitUntilReady();

    await queue.enqueue({ executionId }, { jobId, attempts: 1, backoffMs: 10 });
    await queue.enqueue({ executionId }, { jobId, attempts: 1, backoffMs: 10 });

    await waitFor(() => processed.length === 1);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(processed).toEqual([executionId]);
  });
});
