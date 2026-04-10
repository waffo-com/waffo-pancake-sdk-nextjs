"use client";

import { useCallback, useContext, useMemo, useState } from "react";

import { PancakeContext } from "./provider.js";

import type {
  CancelSubscriptionParams,
  CancelSubscriptionResult,
  CancelOnetimeOrderParams,
  CancelOnetimeOrderResult,
  ReactivateSubscriptionParams,
  ReactivateSubscriptionResult,
  CreateRefundTicketParams,
  ResubmitRefundTicketParams,
  RefundTicket,
  GraphQLParams,
  GraphQLResponse,
} from "@waffo/pancake-ts";

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
 * Must be used within `<WaffoPancakeProvider>`. All operations are executed
 * via server actions — the private key never leaves the server.
 *
 * @returns Buyer action handlers with loading/error states
 *
 * @example
 * ```tsx
 * function AccountPage() {
 *   const buyer = useBuyer();
 *   return (
 *     <button onClick={() => buyer.cancelSubscription.execute({ orderId: "ORD_xxx" })}>
 *       Cancel
 *     </button>
 *   );
 * }
 * ```
 */
export function useBuyer(): UseBuyerReturn {
  const ctx = useContext(PancakeContext);
  if (!ctx) throw new Error("useBuyer: must be used within <WaffoPancakeProvider>");

  const { getBuyerToken, buyerSessionAction } = ctx;

  const callAction = useCallback(
    async (actionType: string, params: unknown) => {
      const token = await getBuyerToken();
      return buyerSessionAction(token, actionType as never, params);
    },
    [getBuyerToken, buyerSessionAction],
  );

  const cancelSubscription = useBuyerAction<CancelSubscriptionParams, CancelSubscriptionResult>(
    useCallback((params) => callAction("cancelSubscription", params) as Promise<CancelSubscriptionResult>, [callAction]),
  );

  const cancelOnetimeOrder = useBuyerAction<CancelOnetimeOrderParams, CancelOnetimeOrderResult>(
    useCallback((params) => callAction("cancelOnetimeOrder", params) as Promise<CancelOnetimeOrderResult>, [callAction]),
  );

  const reactivateSubscription = useBuyerAction<ReactivateSubscriptionParams, ReactivateSubscriptionResult>(
    useCallback((params) => callAction("reactivateSubscription", params) as Promise<ReactivateSubscriptionResult>, [callAction]),
  );

  const createRefundTicket = useBuyerAction<CreateRefundTicketParams, { ticket: RefundTicket }>(
    useCallback((params) => callAction("createRefundTicket", params) as Promise<{ ticket: RefundTicket }>, [callAction]),
  );
  const createRefundTicketMapped = useMemo(
    () => ({ ...createRefundTicket, data: createRefundTicket.data?.ticket ?? null }),
    [createRefundTicket],
  );

  const resubmitRefundTicket = useBuyerAction<ResubmitRefundTicketParams, { ticket: RefundTicket }>(
    useCallback((params) => callAction("resubmitRefundTicket", params) as Promise<{ ticket: RefundTicket }>, [callAction]),
  );
  const resubmitRefundTicketMapped = useMemo(
    () => ({ ...resubmitRefundTicket, data: resubmitRefundTicket.data?.ticket ?? null }),
    [resubmitRefundTicket],
  );

  const query = useCallback(
    async <T = Record<string, unknown>>(params: GraphQLParams) => {
      const token = await getBuyerToken();
      return buyerSessionAction(token, "query", params) as Promise<GraphQLResponse<T>>;
    },
    [getBuyerToken, buyerSessionAction],
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
