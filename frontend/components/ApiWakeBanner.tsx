'use client';

import * as React from 'react';
import { ensureApiAwake, useApiWakeStore } from '@/lib/apiWakeUp';

/**
 * Explains the wait while the API starts up after sleeping, instead of letting the
 * first request fail. Also wakes the API as soon as any page loads, so it is often
 * ready by the time someone signs in.
 */
export function ApiWakeBanner() {
  const status = useApiWakeStore((state) => state.status);
  const waiting = useApiWakeStore((state) => state.waiting);

  React.useEffect(() => {
    void ensureApiAwake({ visible: false });
  }, []);

  if (status === 'unreachable') {
    return (
      <div role="alert" className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-rose-600 px-4 py-2 text-sm text-white">
        <span>The server is not answering right now.</span>
        <button
          type="button"
          onClick={() => void ensureApiAwake()}
          className="rounded-md bg-white/15 px-2.5 py-1 font-medium hover:bg-white/25"
        >
          Try again
        </button>
      </div>
    );
  }

  if (status !== 'waking' || waiting === 0) return null;

  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 top-0 z-50 bg-amber-500 px-4 py-2 text-center text-sm text-white">
      Starting the server. The free hosting plan puts it to sleep after 15 minutes without
      visitors, so this can take up to a minute. Your request will continue on its own.
    </div>
  );
}

export default ApiWakeBanner;
