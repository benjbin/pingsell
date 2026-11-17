import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from './auth';
import type { ApiClient } from './api';

interface QueryState<T> {
  data: T | null;
  error: string | null;
  /** True until the first response (success or error) arrives. */
  loading: boolean;
  refreshing: boolean;
  /** Pull-to-refresh: keeps current data visible. */
  refresh: () => Promise<void>;
  /** Silent reload (no spinner). */
  reload: () => Promise<void>;
}

/**
 * Minimal data-fetching hook bound to the authenticated API client.
 * `deps` re-run the query when they change (previous data stays visible meanwhile).
 */
export function useApiQuery<T>(
  fetcher: (api: ApiClient) => Promise<T>,
  deps: readonly unknown[] = [],
  options: { refetchOnFocus?: boolean } = {},
): QueryState<T> {
  const { api } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fetcherRef = useRef(fetcher);
  const requestId = useRef(0);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  /** Runs the fetcher; only the latest request may update state. No synchronous setState. */
  const execute = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const result = await fetcherRef.current(api);
      if (id !== requestId.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e instanceof Error ? e.message : 'Une erreur est survenue');
    } finally {
      if (id === requestId.current) {
        setSettled(true);
        setRefreshing(false);
      }
    }
  }, [api]);

  useEffect(() => {
    void execute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execute, ...deps]);

  // Silent refetch when the screen regains focus (skips the first focus, already covered by the initial load).
  const focusedOnce = useRef(false);
  const refetchOnFocus = options.refetchOnFocus ?? false;
  useFocusEffect(
    useCallback(() => {
      if (!refetchOnFocus) return;
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        return;
      }
      void execute();
    }, [refetchOnFocus, execute]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await execute();
  }, [execute]);

  return { data, error, loading: !settled, refreshing, refresh, reload: execute };
}
