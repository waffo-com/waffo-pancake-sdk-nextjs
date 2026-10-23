"use client";

import { useCallback, useEffect, useState } from "react";

import type { GraphQLResponse } from "@waffo/pancake-ts";

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
 * @param queryFn - Async function that returns the data, or `null` when there is none
 * @param ready - Whether to start fetching (false = wait)
 * @returns Query state with data, loading, error, and refetch
 */
export function useQuery<T>(queryFn: () => Promise<T | null>, ready: boolean): QueryState<T> {
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

/**
 * Read `data` from a GraphQL response envelope, surfacing GraphQL errors.
 *
 * Data hooks call this inside their query function, so a thrown error lands in
 * the hook's `error` state instead of being dropped.
 *
 * - `errors` non-empty: throws an `Error` whose message is each GraphQL error
 *   message verbatim, joined with `"; "`; partial `data` next to errors is discarded
 * - otherwise: returns `data`, which is `null` when the server sent none
 *
 * @param response - GraphQL envelope as returned by `graphql.query()`
 * @returns The `data` field, or `null`
 *
 * @example
 * ```ts
 * readGraphQLData({ data: { payments: [] } });
 * // => { payments: [] }
 * readGraphQLData({ data: null, errors: [{ message: 'Cannot query field "x" on type "Payment".' }] });
 * // throws Error('Cannot query field "x" on type "Payment".')
 * ```
 */
export function readGraphQLData<T>(response: GraphQLResponse<T> | null | undefined): T | null {
  const errors = response?.errors;
  if (errors && errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  return response?.data ?? null;
}
