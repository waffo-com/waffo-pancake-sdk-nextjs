"use client";

import { useCallback, useMemo, useState } from "react";

import type { WaffoPancake, CancelSubscriptionParams, CancelSubscriptionResult, CancelOnetimeOrderParams, CancelOnetimeOrderResult, ReactivateSubscriptionParams, ReactivateSubscriptionResult, CreateRefundTicketParams, ResubmitRefundTicketParams, RefundTicket, GraphQLParams, GraphQLResponse } from "@waffo/pancake-ts";

/** State of an async buyer action */
export interface BuyerActionState<T = unknown> {
  /** Execute the action */
  execute: (params: T) => Promise<void>;
  /** Whether the action is in progress */
  isLoading: boolean;
  /** Error from the last attempt */
  error: Error | null;
}

/** Return type of useBuyer hook */
export interface UseBuyerReturn {
  /** Cancel a subscription order */
  cancelSubscription: BuyerActionState<CancelSubscriptionParams> & { data: CancelSubscriptionResult | null };
  /** Cancel a one-time order */
  cancelOnetimeOrder: BuyerActionState<CancelOnetimeOrderParams> & { data: CancelOnetimeOrderResult | null };
  /** Reactivate a canceling subscription */
  reactivateSubscription: BuyerActionState<ReactivateSubscriptionParams> & { data: ReactivateSubscriptionResult | null };
  /** Create a refund ticket */
  createRefundTicket: BuyerActionState<CreateRefundTicketParams> & { data: RefundTicket | null };
  /** Resubmit a rejected refund ticket */
  resubmitRefundTicket: BuyerActionState<ResubmitRefundTicketParams> & { data: RefundTicket | null };
  /** Execute a GraphQL query */
  query: <T = Record<string, unknown>>(params: GraphQLParams) => Promise<GraphQLResponse<T>>;
}

function useBuyerAction<TParams, TResult>(
  actionFn: (params: TParams) => Promise<TResult>,
): BuyerActionState<TParams> & { data: TResult | null } {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<TResult | null>(null);

  const execute = useCallback(
    async (params: TParams) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await actionFn(params);
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [actionFn],
  );

  return { execute, isLoading, error, data };
}

/**
 * React hook for buyer self-service actions.
 *
 * Wraps `client.buyer(token)` methods with React state management
 * (loading, error, data) for each action.
 *
 * @param client - Waffo Pancake client instance
 * @param token - Buyer session token (from `client.auth.issueSessionToken()`)
 * @returns Buyer action handlers with loading/error states
 *
 * @example
 * ```tsx
 * const buyer = useBuyer(client, sessionToken);
 *
 * // Cancel a subscription
 * <button
 *   onClick={() => buyer.cancelSubscription.execute({ orderId: "ORD_xxx" })}
 *   disabled={buyer.cancelSubscription.isLoading}
 * >
 *   Cancel Subscription
 * </button>
 *
 * // Show result
 * {buyer.cancelSubscription.data && (
 *   <p>Status: {buyer.cancelSubscription.data.status}</p>
 * )}
 *
 * // GraphQL query
 * const orders = await buyer.query({ query: `{ orders { id status } }` });
 * ```
 */
export function useBuyer(client: WaffoPancake, token: string): UseBuyerReturn {
  const session = useMemo(() => client.buyer(token), [client, token]);

  const cancelSubscription = useBuyerAction<CancelSubscriptionParams, CancelSubscriptionResult>(
    useCallback((params) => session.cancelSubscription(params), [session]),
  );

  const cancelOnetimeOrder = useBuyerAction<CancelOnetimeOrderParams, CancelOnetimeOrderResult>(
    useCallback((params) => session.cancelOnetimeOrder(params), [session]),
  );

  const reactivateSubscription = useBuyerAction<ReactivateSubscriptionParams, ReactivateSubscriptionResult>(
    useCallback((params) => session.reactivateSubscription(params), [session]),
  );

  const createRefundTicket = useBuyerAction<CreateRefundTicketParams, { ticket: RefundTicket }>(
    useCallback((params) => session.createRefundTicket(params), [session]),
  );
  const createRefundTicketMapped = useMemo(
    () => ({
      ...createRefundTicket,
      data: createRefundTicket.data?.ticket ?? null,
    }),
    [createRefundTicket],
  );

  const resubmitRefundTicket = useBuyerAction<ResubmitRefundTicketParams, { ticket: RefundTicket }>(
    useCallback((params) => session.resubmitRefundTicket(params), [session]),
  );
  const resubmitRefundTicketMapped = useMemo(
    () => ({
      ...resubmitRefundTicket,
      data: resubmitRefundTicket.data?.ticket ?? null,
    }),
    [resubmitRefundTicket],
  );

  const query = useCallback(
    <T = Record<string, unknown>>(params: GraphQLParams) => session.graphql.query<T>(params),
    [session],
  );

  return {
    cancelSubscription,
    cancelOnetimeOrder,
    reactivateSubscription,
    createRefundTicket: createRefundTicketMapped,
    resubmitRefundTicket: resubmitRefundTicketMapped,
    query,
  };
}
