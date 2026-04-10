"use client";

import { useCallback } from "react";

import { useQuery } from "./use-query.js";

import type { MerchantQueryAction } from "./server.js";
import type { QueryState } from "./use-query.js";
import type { GraphQLResponse } from "@waffo/pancake-ts";

// ============================================================
// Merchant Data Hooks (via server action)
// ============================================================

/** A merchant's recent order (one-time or subscription) */
export interface MerchantOrder {
  id: string;
  status: string;
  currency: string;
  buyerEmail: string;
  testMode: boolean;
  product: { id: string; name: string } | null;
  payments: Array<{ id: string; status: string; snapshotDisplayAmount: string; snapshotDisplayCurrency: string }>;
  createdAt: string;
}

/** Sales overview statistics */
export interface SalesOverview {
  totalOrders: number;
  totalRevenue: string;
  totalCustomers: number;
  currency: string;
  ordersByStatus: Array<{ status: string; count: number }>;
  revenueByPeriod: Array<{ period: string; amount: string }>;
}

/** Subscription overview */
export interface SubscriptionOverview {
  activeCount: number;
  cancelingCount: number;
  pastDueCount: number;
  totalCount: number;
  subscriptions: MerchantSubscription[];
}

/** A merchant's subscription with status details */
export interface MerchantSubscription {
  id: string;
  status: string;
  currency: string;
  buyerEmail: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  product: { id: string; name: string; billingPeriod: string } | null;
  createdAt: string;
}

export interface MerchantOrdersOptions {
  /** Store ID to filter by */
  storeId: string;
  /** Max results (default: 20) */
  limit?: number;
}

const MERCHANT_ORDERS_QUERY = `query ($storeId: ID!, $limit: Int) {
  onetimeOrders(storeId: $storeId, limit: $limit) {
    id status currency buyerEmail testMode createdAt
    product { id name }
    payments { id status snapshotDisplayAmount snapshotDisplayCurrency }
  }
  subscriptionOrders(storeId: $storeId, limit: $limit) {
    id status currency buyerEmail testMode createdAt
    product { id name }
    payments { id status snapshotDisplayAmount snapshotDisplayCurrency }
  }
}`;

/**
 * Fetch recent orders for a store (one-time + subscription).
 *
 * @param query - Server action from `createMerchantQueryAction()`
 * @param options - Store ID and optional limit
 * @returns Recent orders with product info and payment summary
 *
 * @example
 * ```tsx
 * const { data, isLoading, refetch } = useMerchantOrders(merchantQuery, { storeId: "STO_xxx" });
 * ```
 */
export function useMerchantOrders(
  query: MerchantQueryAction,
  options: MerchantOrdersOptions,
): QueryState<{ onetimeOrders: MerchantOrder[]; subscriptionOrders: MerchantOrder[] }> {
  const { storeId, limit = 20 } = options;

  const queryFn = useCallback(async () => {
    const result = (await query({
      query: MERCHANT_ORDERS_QUERY,
      variables: { storeId, limit },
    })) as unknown as GraphQLResponse<{ onetimeOrders: MerchantOrder[]; subscriptionOrders: MerchantOrder[] }>;
    return result.data as { onetimeOrders: MerchantOrder[]; subscriptionOrders: MerchantOrder[] };
  }, [query, storeId, limit]);

  return useQuery(queryFn, true);
}

const MERCHANT_SALES_QUERY = `query ($storeId: ID!) {
  orderStatistics(storeId: $storeId) {
    totalCount
    countByStatus { status count }
  }
  paymentStatistics(storeId: $storeId) {
    totalSucceededAmount
    totalSucceededCurrency
    totalSucceededCount
  }
  customerAnalysis(storeId: $storeId) {
    totalCustomers
  }
  trendAnalysis(storeId: $storeId) {
    revenueByPeriod { period amount }
  }
}`;

interface SalesQueryData {
  orderStatistics: { totalCount: number; countByStatus: Array<{ status: string; count: number }> };
  paymentStatistics: { totalSucceededAmount: string; totalSucceededCurrency: string; totalSucceededCount: number };
  customerAnalysis: { totalCustomers: number };
  trendAnalysis: { revenueByPeriod: Array<{ period: string; amount: string }> };
}

/**
 * Fetch sales overview for a store.
 *
 * @param query - Server action from `createMerchantQueryAction()`
 * @param storeId - Store ID
 * @returns Aggregated sales statistics
 *
 * @example
 * ```tsx
 * const { data: sales } = useMerchantSales(merchantQuery, "STO_xxx");
 * ```
 */
export function useMerchantSales(query: MerchantQueryAction, storeId: string): QueryState<SalesOverview> {
  const queryFn = useCallback(async () => {
    const result = (await query({
      query: MERCHANT_SALES_QUERY,
      variables: { storeId },
    })) as unknown as GraphQLResponse<SalesQueryData>;
    const d = result.data as SalesQueryData;
    return {
      totalOrders: d.orderStatistics.totalCount,
      totalRevenue: d.paymentStatistics.totalSucceededAmount,
      totalCustomers: d.customerAnalysis.totalCustomers,
      currency: d.paymentStatistics.totalSucceededCurrency,
      ordersByStatus: d.orderStatistics.countByStatus,
      revenueByPeriod: d.trendAnalysis.revenueByPeriod,
    };
  }, [query, storeId]);

  return useQuery(queryFn, true);
}

const MERCHANT_SUBSCRIPTIONS_QUERY = `query ($storeId: ID!) {
  subscriptionOrders(storeId: $storeId, limit: 100) {
    id status currency buyerEmail currentPeriodStart currentPeriodEnd cancelAt createdAt
    product { id name billingPeriod }
  }
}`;

/**
 * Fetch subscription overview for a store.
 *
 * @param query - Server action from `createMerchantQueryAction()`
 * @param storeId - Store ID
 * @returns Subscription counts and detailed list
 *
 * @example
 * ```tsx
 * const { data: subs } = useMerchantSubscriptions(merchantQuery, "STO_xxx");
 * ```
 */
export function useMerchantSubscriptions(query: MerchantQueryAction, storeId: string): QueryState<SubscriptionOverview> {
  const queryFn = useCallback(async () => {
    const result = (await query({
      query: MERCHANT_SUBSCRIPTIONS_QUERY,
      variables: { storeId },
    })) as unknown as GraphQLResponse<{ subscriptionOrders: MerchantSubscription[] }>;
    const subs = (result.data as { subscriptionOrders: MerchantSubscription[] }).subscriptionOrders;
    return {
      activeCount: subs.filter((s) => s.status === "active").length,
      cancelingCount: subs.filter((s) => s.status === "canceling").length,
      pastDueCount: subs.filter((s) => s.status === "past_due").length,
      totalCount: subs.length,
      subscriptions: subs,
    };
  }, [query, storeId]);

  return useQuery(queryFn, true);
}
