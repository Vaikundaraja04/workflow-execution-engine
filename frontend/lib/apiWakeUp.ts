import { create } from 'zustand';

/**
 * Render's free web services sleep after 15 minutes without traffic and take about a
 * minute to start again. A request sent while the API is still starting used to time
 * out (the client gave up after 30 seconds), so the first sign-in after a quiet spell
 * failed. Every API request now waits here until the API's liveness check answers.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const ATTEMPT_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 2_000;
const GIVE_UP_AFTER_MS = 150_000;
/** After a successful check or request, skip the check for this long. */
const TRUST_AWAKE_FOR_MS = 60_000;

export type ApiWakeStatus = 'unknown' | 'waking' | 'awake' | 'unreachable';

interface ApiWakeState {
  status: ApiWakeStatus;
  /** Requests (or pages) currently waiting for the API to answer. */
  waiting: number;
}

export const useApiWakeStore = create<ApiWakeState>(() => ({ status: 'unknown', waiting: 0 }));

let awakeUntil = 0;
let pendingCheck: Promise<boolean> | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiAnswers(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}/health/live`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: string };
    return body.status === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Call after any successful API response. */
export function markApiAwake(): void {
  awakeUntil = Date.now() + TRUST_AWAKE_FOR_MS;
  if (useApiWakeStore.getState().status !== 'awake') {
    useApiWakeStore.setState({ status: 'awake' });
  }
}

/** Call when a request got no answer at all, so the next request checks again. */
export function markApiMaybeAsleep(): void {
  awakeUntil = 0;
}

function runCheck(): Promise<boolean> {
  pendingCheck ??= (async () => {
    const startedAt = Date.now();
    // Show "starting" only if the first answer takes a moment; a quick answer shows nothing.
    const showWaking = setTimeout(() => {
      useApiWakeStore.setState({ status: 'waking' });
    }, 1_500);
    try {
      while (Date.now() - startedAt < GIVE_UP_AFTER_MS) {
        if (await apiAnswers()) {
          markApiAwake();
          return true;
        }
        useApiWakeStore.setState({ status: 'waking' });
        await sleep(RETRY_DELAY_MS);
      }
      useApiWakeStore.setState({ status: 'unreachable' });
      return false;
    } finally {
      clearTimeout(showWaking);
      pendingCheck = null;
    }
  })();
  return pendingCheck;
}

/**
 * Resolves once the API answers (or after about 2.5 minutes without an answer).
 * `visible: false` warms the API up without counting as a waiting request, so the
 * "starting" notice stays hidden on pages that are not waiting for data.
 */
export async function ensureApiAwake(options: { visible?: boolean } = {}): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  if (Date.now() < awakeUntil) return true;
  const visible = options.visible !== false;
  if (visible) useApiWakeStore.setState((state) => ({ waiting: state.waiting + 1 }));
  try {
    return await runCheck();
  } finally {
    if (visible) useApiWakeStore.setState((state) => ({ waiting: Math.max(0, state.waiting - 1) }));
  }
}
