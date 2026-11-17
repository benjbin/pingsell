import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { errorMessage } from "./api";

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (updater: T | ((prev: T | undefined) => T)) => void;
}

/** Runs an async loader on mount / when deps change, ignoring stale responses. */
export function useAsync<T>(loader: () => Promise<T>, deps: DependencyList = []): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const callId = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(async () => {
    const id = ++callId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loaderRef.current();
      if (id === callId.current) setDataState(result);
    } catch (err) {
      if (id === callId.current) setError(errorMessage(err));
    } finally {
      if (id === callId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((updater: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof updater === "function" ? (updater as (p: T | undefined) => T)(prev) : updater));
  }, []);

  return { data, error, loading, reload: run, setData };
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
