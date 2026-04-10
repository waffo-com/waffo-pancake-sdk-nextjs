"use client";

import { useCallback, useEffect, useState } from "react";

/** Query state with typed data */
export interface QueryState<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Internal hook for async data fetching with loading/error state.
 *
 * @param queryFn - Async function that returns the data
 * @param ready - Whether to start fetching (false = wait)
 * @returns Query state with data, loading, error, and refetch
 */
export function useQuery<T>(queryFn: () => Promise<T>, ready: boolean): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(() => {
    if (!ready) return;
    setIsLoading(true);
    setError(null);
    queryFn()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
      .finally(() => setIsLoading(false));
  }, [queryFn, ready]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, isLoading, error, refetch: fetch };
}
