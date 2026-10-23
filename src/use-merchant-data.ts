"use client";

import { useCallback } from "react";

import { readGraphQLData, useQuery } from "./use-query.js";

import type { MerchantQueryAction } from "./server.js";
import type { GraphQLMoney } from "./types.js";
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
  /** Product version the order was placed for; `null` when the order has none recorded */
  productVersion: { productId: string; versionNumber: number; name: string } | null;
  /** Payments on the order; `amount` is the total charged to the buyer */
  payments: Array<{ id: string; status: string; amount: GraphQLMoney }>;
  createdAt: string;
}

/**
 * Sales overview statistics for one time range.
 *
 * Monetary fields (`totalRevenue`, `revenueByPeriod[].amount`) are display-formatted
 * strings in major units (e.g., `"9.99"`), counted from succeeded payments in
 * `currency` at the amount charged to buyers.
 */
export interface SalesOverview {
  /** Orders created in the time range */
  totalOrders: number;
  /** Succeeded payment revenue in `currency` as display string (e.g., `"1234.56"`); `"0"` when there is none */
  totalRevenue: string;
  /** Distinct buyers with orders in the time range */
  totalCustomers: number;
  /** Currency of `totalRevenue` and `revenueByPeriod` — the `currency` option */
  currency: string;
  ordersByStatus: Array<{ status: string; count: number }>;
  /** Revenue by period in `currency`; `amount` is a display string (e.g., `"9.99"`) */
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
  /** When the subscription was canceled; `null` while it is not canceled */
  canceledAt: string | null;
  /** Product version the subscription is on; `null` when the order has none recorded */
  productVersion: { productId: string; versionNumber: number; name: string; billingPeriod: string } | null;
  createdAt: string;
}

export interface MerchantOrdersOptions {
  /** Store ID to filter by */
  storeId: string;
  /** Max results (default: 20) */
  limit?: number;
}

/** Bucket size of {@link SalesOverview.revenueByPeriod} */
export type MerchantSalesGranularity = "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR" | "ALL_TIME";

export interface MerchantSalesOptions {
  /** Store ID */
  storeId: string;
  /** Start of the time range, inclusive (ISO 8601, e.g. `"2026-10-01"`) */
  startDate: string;
  /** End of the time range, exclusive (ISO 8601, e.g. `"2026-11-01"`) */
  endDate: string;
  /** ISO 4217 currency that revenue is reported in */
  currency: string;
  /** Bucket size of `revenueByPeriod` (default: `"DAY"`) */
  granularity?: MerchantSalesGranularity;
}

/** @internal Exported for the schema regression test */
export const MERCHANT_ORDERS_QUERY = `query ($storeId: String!, $limit: Int) {
  onetimeOrders(storeId: $storeId, limit: $limit) {
    id status currency buyerEmail testMode createdAt
    productVersion { productId versionNumber name }
    payments { id status amount { amount currency display } }
  }
  subscriptionOrders(storeId: $storeId, limit: $limit) {
    id status currency buyerEmail testMode createdAt
    productVersion { productId versionNumber name }
    payments { id status amount { amount currency display } }
  }
}`;

interface MerchantOrdersData {
  onetimeOrders: MerchantOrder[];
  subscriptionOrders: MerchantOrder[];
}

/**
 * Fetch recent orders for a store (one-time + subscription).
 *
 * GraphQL errors surface as `error` with the server's message.
 *
 * @param query - Server action from `createMerchantQueryAction()`
 * @param options - Store ID and optional limit
 * @returns Recent orders with product version and payment summary
 *
 * @example
 * ```tsx
 * const { data, isLoading, error, refetch } = useMerchantOrders(merchantQuery, { storeId: "STO_xxx" });
 * // data?.onetimeOrders[0].productVersion?.name, data?.onetimeOrders[0].payments[0].amount.display
 * ```
 */
export function useMerchantOrders(query: MerchantQueryAction, options: MerchantOrdersOptions): QueryState<MerchantOrdersData> {
  const { storeId, limit = 20 } = options;

  const queryFn = useCallback(async () => {
    const result = (await query({
      query: MERCHANT_ORDERS_QUERY,
      variables: { storeId, limit },
    })) as unknown as GraphQLResponse<MerchantOrdersData>;
    return readGraphQLData(result);
  }, [query, storeId, limit]);

  return useQuery(queryFn, true);
}

/** @internal Exported for the schema regression test */
export const MERCHANT_SALES_QUERY = `query ($storeId: String!, $filter: AnalyticsFilterInput!, $granularity: TimePeriodGranularity!, $currency: String!) {
  orderStatistics(storeId: $storeId, filter: $filter) {
    totalCount
    countsByStatus { status count }
    revenueByCurrency { currency snapshotTotalAmount }
    revenueByPeriod(granularity: $granularity, currency: $currency) { period snapshotTotalAmount }
    buyerMetrics { totalBuyers }
  }
}`;

interface SalesQueryData {
  orderStatistics: {
    totalCount: number;
    countsByStatus: Array<{ status: string; count: number }>;
    revenueByCurrency: Array<{ currency: string; snapshotTotalAmount: string }>;
    revenueByPeriod: Array<{ period: string; snapshotTotalAmount: string }>;
    buyerMetrics: { totalBuyers: number };
  } | null;
}

/**
 * Fetch the sales overview of a store for one time range.
 *
 * Revenue counts succeeded payments in `currency`, at the amount charged to buyers.
 * `data` stays `null` when the server returns no statistics; GraphQL errors surface
 * as `error` with the server's message.
 *
 * @param query - Server action from `createMerchantQueryAction()`
 * @param options - Store, time range, revenue currency and period granularity
 * @returns Aggregated sales statistics
 *
 * @example
 * ```tsx
 * const { data: sales } = useMerchantSales(merchantQuery, {
 *   storeId: "STO_xxx",
 *   startDate: "2026-10-01",
 *   endDate: "2026-11-01",
 *   currency: "USD",
 *   granularity: "WEEK",
 * });
 * // sales?.totalRevenue => "1234.56"
 * ```
 */
export function useMerchantSales(query: MerchantQueryAction, options: MerchantSalesOptions): QueryState<SalesOverview> {
  const { storeId, startDate, endDate, currency, granularity = "DAY" } = options;

  const queryFn = useCallback(async () => {
    const result = (await query({
      query: MERCHANT_SALES_QUERY,
      variables: { storeId, filter: { timeRange: { startDate, endDate } }, granularity, currency },
    })) as unknown as GraphQLResponse<SalesQueryData>;
    const stats = readGraphQLData(result)?.orderStatistics;
    if (!stats) return null;
    return {
      totalOrders: stats.totalCount,
      totalRevenue: stats.revenueByCurrency.find((r) => r.currency === currency)?.snapshotTotalAmount ?? "0",
      totalCustomers: stats.buyerMetrics.totalBuyers,
      currency,
      ordersByStatus: stats.countsByStatus,
      revenueByPeriod: stats.revenueByPeriod.map((p) => ({ period: p.period, amount: p.snapshotTotalAmount })),
    };
  }, [query, storeId, startDate, endDate, currency, granularity]);

  return useQuery(queryFn, true);
}

/** @internal Exported for the schema regression test */
export const MERCHANT_SUBSCRIPTIONS_QUERY = `query ($storeId: String!) {
  subscriptionOrders(storeId: $storeId, limit: 100) {
    id status currency buyerEmail currentPeriodStart currentPeriodEnd canceledAt createdAt
    productVersion { productId versionNumber name billingPeriod }
  }
}`;

/**
 * Fetch subscription overview for a store.
 *
 * Counts cover the 100 most recent subscriptions. `data` stays `null` when the
 * server returns no data; GraphQL errors surface as `error` with the server's message.
 *
 * @param query - Server action from `createMerchantQueryAction()`
 * @param storeId - Store ID
 * @returns Subscription counts and detailed list
 *
 * @example
 * ```tsx
 * const { data: subs } = useMerchantSubscriptions(merchantQuery, "STO_xxx");
 * // subs?.activeCount => 12
 * ```
 */
export function useMerchantSubscriptions(query: MerchantQueryAction, storeId: string): QueryState<SubscriptionOverview> {
  const queryFn = useCallback(async () => {
    const result = (await query({
      query: MERCHANT_SUBSCRIPTIONS_QUERY,
      variables: { storeId },
    })) as unknown as GraphQLResponse<{ subscriptionOrders: MerchantSubscription[] }>;
    const subs = readGraphQLData(result)?.subscriptionOrders;
    if (!subs) return null;
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
