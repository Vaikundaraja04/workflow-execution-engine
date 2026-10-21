import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A fresh copy of the module per test, so its "awake until" timer starts empty.
async function loadModule() {
  vi.resetModules();
  return import('@/lib/apiWakeUp');
}

function liveResponse(ok: boolean) {
  return { ok, json: async () => ({ status: ok ? 'ok' : 'starting' }) } as Response;
}

describe('waking the API before requests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits until the liveness check answers, then reports the API awake', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(liveResponse(false))
      .mockResolvedValueOnce(liveResponse(true));
    vi.stubGlobal('fetch', fetchMock);
    const { ensureApiAwake, useApiWakeStore } = await loadModule();

    const waiting = ensureApiAwake();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(waiting).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/health\/live$/);
    expect(useApiWakeStore.getState()).toMatchObject({ status: 'awake', waiting: 0 });
  });

  it('skips the check right after a successful request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { ensureApiAwake, markApiAwake } = await loadModule();

    markApiAwake();

    await expect(ensureApiAwake()).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shares one check between requests that wait at the same time', async () => {
    const fetchMock = vi.fn().mockResolvedValue(liveResponse(true));
    vi.stubGlobal('fetch', fetchMock);
    const { ensureApiAwake } = await loadModule();

    await Promise.all([ensureApiAwake(), ensureApiAwake(), ensureApiAwake()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after about two and a half minutes and says the server is not answering', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { ensureApiAwake, useApiWakeStore } = await loadModule();

    const waiting = ensureApiAwake();
    await vi.advanceTimersByTimeAsync(160_000);

    await expect(waiting).resolves.toBe(false);
    expect(useApiWakeStore.getState().status).toBe('unreachable');
  });
});
