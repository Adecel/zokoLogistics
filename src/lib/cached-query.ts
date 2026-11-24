import { useCallback, useEffect, useState } from 'react';

// Load data once and share it between screens (small, rarely changing data:
// catalogue, settings). `reload()` fetches again.
export function createCachedQuery<T>(fetcher: () => Promise<T>) {
  let cache: Promise<T> | null = null;

  function invalidate() {
    cache = null;
  }

  function useQuery() {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
      let active = true;
      cache ??= fetcher();
      cache.then(
        (value) => {
          if (active) {
            setData(value);
            setError(null);
          }
        },
        (e: Error) => {
          cache = null; // allow a retry
          if (active) setError(e.message);
        },
      );
      return () => {
        active = false;
      };
    }, [attempt]);

    const reload = useCallback(() => {
      cache = null;
      setError(null);
      setData(null);
      setAttempt((a) => a + 1);
    }, []);

    return { data, error, loading: !data && !error, reload };
  }

  return { useQuery, invalidate };
}
