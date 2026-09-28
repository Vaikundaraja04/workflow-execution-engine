// Shared MongoDB transaction helper: the driver does not retry transient
// replica-set errors on its own, so run the callback again on transient
// conditions (elections, catalog changes during index builds, lock conflicts)
// the same way the workflow transfer flow does.
import mongoose from 'mongoose';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 50;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableTransactionError(error: unknown): boolean {
  const labels = (error as { errorLabels?: string[] } | null)?.errorLabels ?? [];
  if (labels.includes('TransientTransactionError')) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /catalog changes/i.test(message) || /Unable to acquire .* lock/i.test(message);
}

export async function withTransaction<T>(
  run: (session: mongoose.ClientSession) => Promise<T>,
  options: { maxAttempts?: number; retryBaseDelayMs?: number } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const session = await mongoose.startSession();
  try {
    for (let attempt = 1; ; attempt += 1) {
      session.startTransaction();
      try {
        const result = await run(session);
        await session.commitTransaction();
        return result;
      } catch (error) {
        await session.abortTransaction();
        if (attempt >= maxAttempts || !isRetryableTransactionError(error)) throw error;
        await delay(retryBaseDelayMs * 2 ** (attempt - 1));
      }
    }
  } finally {
    session.endSession();
  }
}