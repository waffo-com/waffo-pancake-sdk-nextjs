"use client";

import { useCallback, useContext } from "react";

import { PancakeContext } from "./provider.js";
import { useQuery } from "./use-query.js";

import type { QueryState } from "./use-query.js";
import type { GraphQLResponse } from "@waffo/pancake-ts";

// ============================================================
// Types
// ============================================================

/** A buyer's one-time order */
export interface BuyerOnetimeOrder {
  id: string;
  status: string;
  currency: string;
  buyerEmail: string;
  product: { id: string; name: string } | null;
  payments: Array<{ id: string; status: string; snapshotDisplayAmount: string; snapshotDisplayCurrency: string; createdAt: string }>;
  createdAt: string;
}

/** A buyer's subscription order */
export interface BuyerSubscriptionOrder {
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

/** A buyer's payment record */
export interface BuyerPayment {
  id: string;
  orderId: string;
  status: string;
  snapshotDisplayAmount: string;
  snapshotDisplayCurrency: string;
  failureReason: string | null;
  createdAt: string;
}

/** A buyer's refund ticket */
export interface BuyerRefundTicket {
  id: string;
  status: string;
  reason: string;
  requestedAmount: string;
  requestedCurrency: string;
  createdAt: string;
}

// ============================================================
// Queries
// ============================================================

const BUYER_ORDERS_QUERY = `query {
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

const BUYER_PAYMENTS_QUERY = `query {
  payments(limit: 50) {
    id orderId status snapshotDisplayAmount snapshotDisplayCurrency failureReason createdAt
  }
}`;

const BUYER_REFUND_TICKETS_QUERY = `query {
  refundTickets(limit: 50) {
    id status reason requestedAmount requestedCurrency createdAt
  }
}`;

// ============================================================
// Internal helper
// ============================================================

function useBuyerQuery<T>(query: string): QueryState<T> {
  const ctx = useContext(PancakeContext);
  if (!ctx) throw new Error("Buyer data hook: must be used within <WaffoPancakeProvider>");

  const { getBuyerToken, buyerSessionAction, isBuyerReady } = ctx;

  const queryFn = useCallback(async () => {
    const token = await getBuyerToken();
    const result = (await buyerSessionAction(token, "query", { query })) as unknown as GraphQLResponse<T>;
    return result.data as T;
  }, [getBuyerToken, buyerSessionAction, query]);

  return useQuery(queryFn, isBuyerReady);
}

// ============================================================
// Hooks
// ============================================================

interface BuyerOrdersData {
  onetimeOrders: BuyerOnetimeOrder[];
  subscriptionOrders: BuyerSubscriptionOrder[];
}

/**
 * Fetch the buyer's order history (one-time + subscription).
 *
 * Must be used within `<WaffoPancakeProvider>`. Token is auto-managed.
 *
 * @returns Orders with product info and payment history
 *
 * @example
 * ```tsx
 * const { data, isLoading, refetch } = useBuyerOrders();
 * // data.onetimeOrders + data.subscriptionOrders
 * ```
 */
export function useBuyerOrders(): QueryState<BuyerOrdersData> {
  return useBuyerQuery<BuyerOrdersData>(BUYER_ORDERS_QUERY);
}

/**
 * Fetch the buyer's payment history.
 *
 * Must be used within `<WaffoPancakeProvider>`. Token is auto-managed.
 *
 * @returns Payment records with amounts and status
 *
 * @example
 * ```tsx
 * const { data: payments, isLoading } = useBuyerPayments();
 * ```
 */
export function useBuyerPayments(): QueryState<BuyerPayment[]> {
  const result = useBuyerQuery<{ payments: BuyerPayment[] }>(BUYER_PAYMENTS_QUERY);
  return { ...result, data: result.data?.payments ?? null };
}

/**
 * Fetch the buyer's refund tickets.
 *
 * Must be used within `<WaffoPancakeProvider>`. Token is auto-managed.
 *
 * @returns Refund tickets with status and requested amounts
 *
 * @example
 * ```tsx
 * const { data: tickets, isLoading } = useBuyerRefundTickets();
 * ```
 */
export function useBuyerRefundTickets(): QueryState<BuyerRefundTicket[]> {
  const result = useBuyerQuery<{ refundTickets: BuyerRefundTicket[] }>(BUYER_REFUND_TICKETS_QUERY);
  return { ...result, data: result.data?.refundTickets ?? null };
}
