"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
 * Behavior:
 * - Runs `queryFn` when `ready` is true, again whenever `queryFn` changes (the data hooks
 *   memoize it on their parameters), and on `refetch()`
 * - Success: `data` is the resolved value, `error` is `null`
 * - Failure: `data` is `null`, `error` is the rejection (non-`Error` values are wrapped)
 *
 * Edge cases:
 * - Only the latest request may settle the state: a response that arrives after a newer
 *   request started (parameters changed, or `refetch()` was called) is discarded, so an
 *   old store's or time range's result never overwrites the current one
 * - `ready` false: nothing is fetched and `isLoading` stays `true`
 *
 * @param queryFn - Async function that returns the data, or `null` when there is none
 * @param ready - Whether to start fetching (false = wait)
 * @returns Query state with data, loading, error, and refetch
 *
 * @example
 * ```ts
 * const queryFn = useCallback(() => loadOrders(storeId), [storeId]);
 * const { data, isLoading, error, refetch } = useQuery(queryFn, true);
 * // switching storeId while a request is in flight: only the new store's result lands in `data`
 * ```
 */
export function useQuery<T>(queryFn: () => Promise<T | null>, ready: boolean): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const latestRequest = useRef(0);

  const fetch = useCallback(() => {
    if (!ready) return;
    const request = ++latestRequest.current;
    const isLatest = () => request === latestRequest.current;
    setIsLoading(true);
    setError(null);
    queryFn()
      .then((result) => {
        if (isLatest()) setData(result);
      })
      .catch((err) => {
        if (!isLatest()) return;
        setData(null);
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (isLatest()) setIsLoading(false);
      });
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
