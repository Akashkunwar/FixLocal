import { useCallback, useEffect, useRef, useState } from "react";
import { isAbort } from "../api/client";

/**
 * Latest-request-wins guard. `begin()` aborts the previous request and returns a signal plus an
 * `isCurrent()` check; only the newest request may write state. Use it for imperative loads
 * (load more, polling, a reload after a save) so an old, slow answer never overwrites a newer one.
 */
export function useRequestGuard() {
  const seq = useRef(0);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      seq.current += 1; // anything still in flight belongs to an unmounted component
      ctrl.current?.abort();
    },
    []
  );
  return useCallback(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const mine = ++seq.current;
    return { signal: c.signal, isCurrent: () => mine === seq.current && !c.signal.aborted };
  }, []);
}

export type QueryState<T> = {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /** Load again with the same key (keeps the current data on screen meanwhile). */
  reload: () => Promise<void>;
  /** Local edits (optimistic updates) without refetching. */
  setData: (update: T | ((prev: T | undefined) => T)) => void;
};

/**
 * Small useQuery: runs `fetcher` whenever `key` changes, aborts the previous run, and ignores
 * answers that arrive for a key that is no longer current. Pass `key = null` to skip.
 * `fetcher` may change identity every render; only `key` decides when to refetch.
 */
export function useQuery<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
  opts: { keepPrevious?: boolean } = {}
): QueryState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(key !== null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const begin = useRequestGuard();
  const keepPrevious = !!opts.keepPrevious;

  const run = useCallback(
    async (clear: boolean) => {
      const { signal, isCurrent } = begin();
      if (clear) setDataState(undefined);
      setLoading(true);
      setError(null);
      try {
        const value = await fetcherRef.current(signal);
        if (!isCurrent()) return;
        setDataState(value);
      } catch (err) {
        if (!isCurrent() || isAbort(err)) return;
        setError(err);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [begin]
  );

  useEffect(() => {
    if (key === null) {
      begin(); // cancel whatever was in flight
      setLoading(false);
      return;
    }
    void run(!keepPrevious);
  }, [key, keepPrevious, run, begin]);

  const reload = useCallback(() => run(false), [run]);
  const setData = useCallback((update: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof update === "function" ? (update as (p: T | undefined) => T)(prev) : update));
  }, []);

  return { data, error, loading, reload, setData };
}
