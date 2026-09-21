'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiClientError } from '@/services/apiClient';

export interface ResourceState<T> {
  data: T | null;
  isLoading: boolean;
  error: ApiClientError | null;
  reload: () => void;
}

export function useResource<T>(load: () => Promise<T>): ResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    load()
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(null);
      })
      .catch((err: ApiClientError) => {
        if (!active) return;
        setError(err);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load, nonce]);

  const reload = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setNonce((value) => value + 1);
  }, []);

  return { data, isLoading, error, reload };
}
