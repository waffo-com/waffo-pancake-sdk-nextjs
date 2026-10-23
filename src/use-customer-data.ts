"use client";

import { useCallback, useContext } from "react";

import { PancakeContext } from "./provider.js";
import { readGraphQLData, useQuery } from "./use-query.js";

import type { GraphQLMoney } from "./types.js";
import type { QueryState } from "./use-query.js";
import type { GraphQLResponse, RefundTicketVersionData } from "@waffo/pancake-ts";

// ============================================================
// Types
// ============================================================

/** A payment on a customer's order */
export interface CustomerOrderPayment {
  id: string;
  status: string;
  /** Total charged to the customer */
  amount: GraphQLMoney;
  createdAt: string;
}

/** A customer's one-time order */
export interface CustomerOnetimeOrder {
  id: string;
  status: string;
  currency: string;
  buyerEmail: string;
  /** Product version the customer bought; `null` when the order has none recorded */
  productVersion: { productId: string; versionNumber: number; name: string } | null;
  payments: CustomerOrderPayment[];
  createdAt: string;
}

/** A customer's subscription order */
export interface CustomerSubscriptionOrder {
  id: string;
  status: string;
  currency: string;
  buyerEmail: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  /** When the subscription was canceled; `null` while it is not canceled */
  canceledAt: string | null;
  /** Product version the subscription is on; `null` when the order has none recorded */
  productVersion: { productId: string; versionNumber: number; name: string; billingPeriod: string } | null;
  payments: CustomerOrderPayment[];
  createdAt: string;
}

/** A customer's payment record */
export interface CustomerPayment {
  id: string;
  orderId: string;
  status: string;
  /** Total charged to the customer */
  amount: GraphQLMoney;
  failureReason: string | null;
  createdAt: string;
}

/**
 * A customer's refund ticket.
 *
 * Ticket-level fields are flat; per-version fields (`reason`, `requestedAmount`)
 * live under `versionData` because the customer can resubmit a rejected ticket and
 * each submission is a versioned record. `versionData` reflects the current
 * (latest) version. The `versionData` shape is shared with `@waffo/pancake-ts`'s
 * `RefundTicketVersionData`.
 */
export interface CustomerRefundTicket {
  id: string;
  status: string;
  versionNumber: number | null;
  versionData: RefundTicketVersionData | null;
  createdAt: string;
}

/**
 * Store scope for {@link useCustomerOrders}.
 *
 * The order lists only return orders of the store named here: pass `storeId` or
 * `storeSlug`, otherwise both lists come back empty. `storeId` wins when both are set.
 */
export interface CustomerOrdersOptions {
  /** Store ID (`STO_xxx`) */
  storeId?: string;
  /** Store slug, as in the store's product page URL */
  storeSlug?: string;
}

/** Store scope for {@link useCustomerPayments}; without `storeId`, every payment the customer session can read is returned */
export interface CustomerPaymentsOptions {
  /** Store ID (`STO_xxx`) */
  storeId?: string;
}

// ============================================================
// Queries
// ============================================================

/** @internal Exported for the schema regression test */
export const CUSTOMER_ORDERS_QUERY = `query ($storeId: String, $storeSlug: String) {
  onetimeOrders(storeId: $storeId, storeSlug: $storeSlug, limit: 50) {
    id status currency buyerEmail createdAt
    productVersion { productId versionNumber name }
    payments { id status amount { amount currency display } createdAt }
  }
  subscriptionOrders(storeId: $storeId, storeSlug: $storeSlug, limit: 50) {
    id status currency buyerEmail currentPeriodStart currentPeriodEnd canceledAt createdAt
    productVersion { productId versionNumber name billingPeriod }
    payments { id status amount { amount currency display } createdAt }
  }
}`;

/** @internal Exported for the schema regression test */
export const CUSTOMER_PAYMENTS_QUERY = `query ($storeId: String) {
  payments(storeId: $storeId, limit: 50) {
    id orderId status amount { amount currency display } failureReason createdAt
  }
}`;

/** @internal Exported for the schema regression test */
export const CUSTOMER_REFUND_TICKETS_QUERY = `query {
  refundTickets(limit: 50) {
    id status versionNumber
    versionData {
      reason
      requestedAmount { amount currency }
    }
    createdAt
  }
}`;

// ============================================================
// Internal helper
// ============================================================

/**
 * Run a customer GraphQL query through the session action.
 *
 * Variables are compared by value, so an inline object literal does not refetch on every render.
 *
 * @param query - GraphQL query string
 * @param variables - Query variables; `undefined` values are left out of the request
 * @returns Query state; GraphQL errors surface as `error`
 */
function useCustomerQuery<T>(query: string, variables?: Record<string, string | undefined>): QueryState<T> {
  const ctx = useContext(PancakeContext);
  if (!ctx) throw new Error("Customer data hook: must be used within <WaffoPancakeProvider>");

  const { getCustomerToken, customerSessionAction, isCustomerReady } = ctx;
  const variablesKey = JSON.stringify(variables ?? {});

  const queryFn = useCallback(async () => {
    const token = await getCustomerToken();
    const params = { query, variables: JSON.parse(variablesKey) as Record<string, string> };
    const result = (await customerSessionAction(token, "query", params)) as GraphQLResponse<T>;
    return readGraphQLData(result);
  }, [getCustomerToken, customerSessionAction, query, variablesKey]);

  return useQuery(queryFn, isCustomerReady);
}

// ============================================================
// Hooks
// ============================================================

interface CustomerOrdersData {
  onetimeOrders: CustomerOnetimeOrder[];
  subscriptionOrders: CustomerSubscriptionOrder[];
}

/**
 * Fetch the customer's order history (one-time + subscription) in one store.
 *
 * Must be used within `<WaffoPancakeProvider>`. Token is auto-managed.
 * Pass `storeId` or `storeSlug`: without either, both lists are empty.
 * GraphQL errors surface as `error` with the server's message.
 *
 * @param options - Store to read orders from
 * @returns Orders with product version and payment history
 *
 * @example
 * ```tsx
 * const { data, isLoading, error, refetch } = useCustomerOrders({ storeId: "STO_xxx" });
 * // data.onetimeOrders[0].productVersion?.name, data.subscriptionOrders[0].canceledAt
 * ```
 */
export function useCustomerOrders(options: CustomerOrdersOptions = {}): QueryState<CustomerOrdersData> {
  return useCustomerQuery<CustomerOrdersData>(CUSTOMER_ORDERS_QUERY, {
    storeId: options.storeId,
    storeSlug: options.storeSlug,
  });
}

/**
 * Fetch the customer's payment history.
 *
 * Must be used within `<WaffoPancakeProvider>`. Token is auto-managed.
 * GraphQL errors surface as `error` with the server's message.
 *
 * @param options - Optional store to limit payments to
 * @returns Payment records with amounts and status
 *
 * @example
 * ```tsx
 * const { data: payments, isLoading } = useCustomerPayments({ storeId: "STO_xxx" });
 * // payments?.[0].amount.display => "9.99"
 * ```
 */
export function useCustomerPayments(options: CustomerPaymentsOptions = {}): QueryState<CustomerPayment[]> {
  const result = useCustomerQuery<{ payments: CustomerPayment[] }>(CUSTOMER_PAYMENTS_QUERY, { storeId: options.storeId });
  return { ...result, data: result.data?.payments ?? null };
}

/**
 * Fetch the customer's refund tickets.
 *
 * Must be used within `<WaffoPancakeProvider>`. Token is auto-managed.
 * GraphQL errors surface as `error` with the server's message.
 *
 * @returns Refund tickets with status and requested amounts
 *
 * @example
 * ```tsx
 * const { data: tickets, isLoading } = useCustomerRefundTickets();
 * ```
 */
export function useCustomerRefundTickets(): QueryState<CustomerRefundTicket[]> {
  const result = useCustomerQuery<{ refundTickets: CustomerRefundTicket[] }>(CUSTOMER_REFUND_TICKETS_QUERY);
  return { ...result, data: result.data?.refundTickets ?? null };
}

// ============================================================
// Deprecated Aliases
// ============================================================

/** @deprecated Use {@link CustomerOnetimeOrder} instead. */
export type BuyerOnetimeOrder = CustomerOnetimeOrder;

/** @deprecated Use {@link CustomerSubscriptionOrder} instead. */
export type BuyerSubscriptionOrder = CustomerSubscriptionOrder;

/** @deprecated Use {@link CustomerPayment} instead. */
export type BuyerPayment = CustomerPayment;

/** @deprecated Use {@link CustomerRefundTicket} instead. */
export type BuyerRefundTicket = CustomerRefundTicket;

/** @deprecated Use {@link useCustomerOrders} instead. */
export const useBuyerOrders = useCustomerOrders;

/** @deprecated Use {@link useCustomerPayments} instead. */
export const useBuyerPayments = useCustomerPayments;

/** @deprecated Use {@link useCustomerRefundTickets} instead. */
export const useBuyerRefundTickets = useCustomerRefundTickets;
