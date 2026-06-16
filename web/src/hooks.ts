import { useEffect, useState } from 'react';
import { Unauthorized } from './api.js';

/** Async resource state for a single panel's fetch. */
export interface Resource<T> {
  loading: boolean;
  data?: T;
  error?: string;
}

/**
 * Load an async resource, re-running whenever `deps` change.
 *
 * A stale in-flight request is ignored on cleanup so fast site/range switches
 * never flash older data. An {@link Unauthorized} short-circuits to
 * `onUnauthed` (the app drops to login) rather than showing a per-panel error.
 */
export function useResource<T>(
  load: () => Promise<T>,
  deps: unknown[],
  onUnauthed: () => void,
): Resource<T> {
  const [state, setState] = useState<Resource<T>>({ loading: true });

  useEffect(() => {
    let live = true;
    setState({ loading: true });
    load().then(
      (data) => {
        if (live) setState({ loading: false, data });
      },
      (err: unknown) => {
        if (!live) return;
        if (err instanceof Unauthorized) {
          onUnauthed();
          return;
        }
        setState({ loading: false, error: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

/**
 * Poll a value on an interval, refreshing immediately when `key` changes.
 * Used by the current-visitors indicator. Auth failures fall through to
 * `onUnauthed`; transient errors keep the last good value.
 */
export function usePoll<T>(
  load: () => Promise<T>,
  intervalMs: number,
  key: string,
  onUnauthed: () => void,
): T | undefined {
  const [value, setValue] = useState<T>();

  useEffect(() => {
    let live = true;
    const tick = (): void => {
      load().then(
        (v) => {
          if (live) setValue(v);
        },
        (err: unknown) => {
          if (err instanceof Unauthorized) onUnauthed();
        },
      );
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      live = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intervalMs]);

  return value;
}
