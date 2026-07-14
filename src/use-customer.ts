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

/** State of an async customer action */
export interface CustomerActionState<T = unknown> {
  /** Execute the action */
  execute: (params: T) => Promise<void>;
  /** Whether the action is in progress */
  isLoading: boolean;
  /** Error from the last attempt */
  error: Error | null;
}

/** Return type of useCustomer hook */
export interface UseCustomerReturn {
  /** Cancel a subscription order */
  cancelSubscription: CustomerActionState<CancelSubscriptionParams> & { data: CancelSubscriptionResult | null };
  /** Cancel a one-time order */
  cancelOnetimeOrder: CustomerActionState<CancelOnetimeOrderParams> & { data: CancelOnetimeOrderResult | null };
  /** Reactivate a canceling subscription */
  reactivateSubscription: CustomerActionState<ReactivateSubscriptionParams> & { data: ReactivateSubscriptionResult | null };
  /** Create a refund ticket */
  createRefundTicket: CustomerActionState<CreateRefundTicketParams> & { data: RefundTicket | null };
  /** Resubmit a rejected refund ticket */
  resubmitRefundTicket: CustomerActionState<ResubmitRefundTicketParams> & { data: RefundTicket | null };
  /** Execute a GraphQL query */
  query: <T = Record<string, unknown>>(params: GraphQLParams) => Promise<GraphQLResponse<T>>;
}

function useCustomerAction<TParams, TResult>(
  actionFn: (params: TParams) => Promise<TResult>,
): CustomerActionState<TParams> & { data: TResult | null } {
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
 * React hook for customer self-service actions.
 *
 * Must be used within `<WaffoPancakeProvider>`. All operations are executed
 * via server actions — the private key never leaves the server.
 *
 * @returns Customer action handlers with loading/error states
 *
 * @example
 * ```tsx
 * function AccountPage() {
 *   const customer = useCustomer();
 *   return (
 *     <button onClick={() => customer.cancelSubscription.execute({ orderId: "ORD_xxx" })}>
 *       Cancel
 *     </button>
 *   );
 * }
 * ```
 */
export function useCustomer(): UseCustomerReturn {
  const ctx = useContext(PancakeContext);
  if (!ctx) throw new Error("useCustomer: must be used within <WaffoPancakeProvider>");

  const { getCustomerToken, customerSessionAction } = ctx;

  const callAction = useCallback(
    async (actionType: string, params: unknown) => {
      const token = await getCustomerToken();
      return customerSessionAction(token, actionType as never, params);
    },
    [getCustomerToken, customerSessionAction],
  );

  const cancelSubscription = useCustomerAction<CancelSubscriptionParams, CancelSubscriptionResult>(
    useCallback((params) => callAction("cancelSubscription", params) as Promise<CancelSubscriptionResult>, [callAction]),
  );

  const cancelOnetimeOrder = useCustomerAction<CancelOnetimeOrderParams, CancelOnetimeOrderResult>(
    useCallback((params) => callAction("cancelOnetimeOrder", params) as Promise<CancelOnetimeOrderResult>, [callAction]),
  );

  const reactivateSubscription = useCustomerAction<ReactivateSubscriptionParams, ReactivateSubscriptionResult>(
    useCallback((params) => callAction("reactivateSubscription", params) as Promise<ReactivateSubscriptionResult>, [callAction]),
  );

  const createRefundTicket = useCustomerAction<CreateRefundTicketParams, { ticket: RefundTicket }>(
    useCallback((params) => callAction("createRefundTicket", params) as Promise<{ ticket: RefundTicket }>, [callAction]),
  );
  const createRefundTicketMapped = useMemo(
    () => ({ ...createRefundTicket, data: createRefundTicket.data?.ticket ?? null }),
    [createRefundTicket],
  );

  const resubmitRefundTicket = useCustomerAction<ResubmitRefundTicketParams, { ticket: RefundTicket }>(
    useCallback((params) => callAction("resubmitRefundTicket", params) as Promise<{ ticket: RefundTicket }>, [callAction]),
  );
  const resubmitRefundTicketMapped = useMemo(
    () => ({ ...resubmitRefundTicket, data: resubmitRefundTicket.data?.ticket ?? null }),
    [resubmitRefundTicket],
  );

  const query = useCallback(
    async <T = Record<string, unknown>>(params: GraphQLParams) => {
      const token = await getCustomerToken();
      return customerSessionAction(token, "query", params) as Promise<GraphQLResponse<T>>;
    },
    [getCustomerToken, customerSessionAction],
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

// ============================================================
// Deprecated Aliases
// ============================================================

/** @deprecated Use {@link CustomerActionState} instead. */
export type BuyerActionState<T = unknown> = CustomerActionState<T>;

/** @deprecated Use {@link UseCustomerReturn} instead. */
export type UseBuyerReturn = UseCustomerReturn;

/** @deprecated Use {@link useCustomer} instead. */
export const useBuyer = useCustomer;
