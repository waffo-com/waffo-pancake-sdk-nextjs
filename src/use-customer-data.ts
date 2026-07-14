"use client";

import { useCallback, useContext } from "react";

import { PancakeContext } from "./provider.js";
import { useQuery } from "./use-query.js";

import type { QueryState } from "./use-query.js";
import type { GraphQLResponse, RefundTicketVersionData } from "@waffo/pancake-ts";

// ============================================================
// Types
// ============================================================

/** A customer's one-time order */
export interface CustomerOnetimeOrder {
  id: string;
  status: string;
  currency: string;
  buyerEmail: string;
  product: { id: string; name: string } | null;
  payments: Array<{ id: string; status: string; snapshotDisplayAmount: string; snapshotDisplayCurrency: string; createdAt: string }>;
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
  cancelAt: string | null;
  product: { id: string; name: string; billingPeriod: string } | null;
  payments: Array<{ id: string; status: string; snapshotDisplayAmount: string; snapshotDisplayCurrency: string; createdAt: string }>;
  createdAt: string;
}

/** A customer's payment record */
export interface CustomerPayment {
  id: string;
  orderId: string;
  status: string;
  snapshotDisplayAmount: string;
  snapshotDisplayCurrency: string;
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

// ============================================================
// Queries
// ============================================================

const CUSTOMER_ORDERS_QUERY = `query {
  onetimeOrders(limit: 50) {
    id status currency buyerEmail createdAt
    product { id name }
    payments { id status snapshotDisplayAmount snapshotDisplayCurrency createdAt }
  }
  subscriptionOrders(limit: 50) {
    id status currency buyerEmail currentPeriodStart currentPeriodEnd cancelAt createdAt
    product { id name billingPeriod }
    payments { id status snapshotDisplayAmount snapshotDisplayCurrency createdAt }
  }
}`;

const CUSTOMER_PAYMENTS_QUERY = `query {
  payments(limit: 50) {
    id orderId status snapshotDisplayAmount snapshotDisplayCurrency failureReason createdAt
  }
}`;

const CUSTOMER_REFUND_TICKETS_QUERY = `query {
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

function useCustomerQuery<T>(query: string): QueryState<T> {
  const ctx = useContext(PancakeContext);
  if (!ctx) throw new Error("Customer data hook: must be used within <WaffoPancakeProvider>");

  const { getCustomerToken, customerSessionAction, isCustomerReady } = ctx;

  const queryFn = useCallback(async () => {
    const token = await getCustomerToken();
    const result = (await customerSessionAction(token, "query", { query })) as unknown as GraphQLResponse<T>;
    return result.data as T;
  }, [getCustomerToken, customerSessionAction, query]);

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
 * Fetch the customer's order history (one-time + subscription).
 *
 * Must be used within `<WaffoPancakeProvider>`. Token is auto-managed.
 *
 * @returns Orders with product info and payment history
 *
 * @example
 * ```tsx
 * const { data, isLoading, refetch } = useCustomerOrders();
 * // data.onetimeOrders + data.subscriptionOrders
 * ```
 */
export function useCustomerOrders(): QueryState<CustomerOrdersData> {
  return useCustomerQuery<CustomerOrdersData>(CUSTOMER_ORDERS_QUERY);
}

/**
 * Fetch the customer's payment history.
 *
 * Must be used within `<WaffoPancakeProvider>`. Token is auto-managed.
 *
 * @returns Payment records with amounts and status
 *
 * @example
 * ```tsx
 * const { data: payments, isLoading } = useCustomerPayments();
 * ```
 */
export function useCustomerPayments(): QueryState<CustomerPayment[]> {
  const result = useCustomerQuery<{ payments: CustomerPayment[] }>(CUSTOMER_PAYMENTS_QUERY);
  return { ...result, data: result.data?.payments ?? null };
}

/**
 * Fetch the customer's refund tickets.
 *
 * Must be used within `<WaffoPancakeProvider>`. Token is auto-managed.
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
