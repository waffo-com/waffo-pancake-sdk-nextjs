import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, it, expect, vi } from "vitest";

import { PancakeContext } from "../provider.js";
import {
  CUSTOMER_ORDERS_QUERY,
  CUSTOMER_PAYMENTS_QUERY,
  useCustomerOrders,
  useCustomerPayments,
  useCustomerRefundTickets,
} from "../use-customer-data.js";
import {
  MERCHANT_ORDERS_QUERY,
  MERCHANT_SALES_QUERY,
  MERCHANT_SUBSCRIPTIONS_QUERY,
  useMerchantOrders,
  useMerchantSales,
  useMerchantSubscriptions,
} from "../use-merchant-data.js";
import { readGraphQLData, useQuery } from "../use-query.js";

import type { PancakeContextValue } from "../provider.js";
import type { MerchantQueryAction } from "../server.js";

const SCHEMA_ERROR = { message: 'Cannot query field "product" on type "OnetimeOrder".' };

function createCustomerContext(response: unknown): PancakeContextValue {
  return {
    getCustomerToken: vi.fn().mockResolvedValue("tok_abc"),
    customerSessionAction: vi.fn().mockResolvedValue(response),
    hasCustomer: true,
    isCustomerReady: true,
  };
}

function createWrapper(ctx: PancakeContextValue) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <PancakeContext.Provider value={ctx}>{children}</PancakeContext.Provider>;
  };
}

function createMerchantQuery(response: unknown): MerchantQueryAction {
  return vi.fn().mockResolvedValue(response) as unknown as MerchantQueryAction;
}

describe("readGraphQLData", () => {
  it("returns data when there are no errors", () => {
    expect(readGraphQLData({ data: { payments: [] } })).toEqual({ payments: [] });
    expect(readGraphQLData({ data: { payments: [] }, errors: [] })).toEqual({ payments: [] });
  });

  it("returns null for a missing envelope or null data", () => {
    expect(readGraphQLData(undefined)).toBeNull();
    expect(readGraphQLData({ data: null })).toBeNull();
  });

  it("throws the GraphQL error messages verbatim, joined", () => {
    expect(() => readGraphQLData({ data: null, errors: [SCHEMA_ERROR] })).toThrow(new Error(SCHEMA_ERROR.message));
    expect(() => readGraphQLData({ data: { x: 1 }, errors: [{ message: "a" }, { message: "b" }] })).toThrow(new Error("a; b"));
  });
});

describe("customer data hooks", () => {
  it("useCustomerOrders sends storeId / storeSlug as variables", async () => {
    const data = { onetimeOrders: [], subscriptionOrders: [] };
    const ctx = createCustomerContext({ data });
    const { result } = renderHook(() => useCustomerOrders({ storeSlug: "my-store" }), { wrapper: createWrapper(ctx) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(ctx.customerSessionAction).toHaveBeenCalledWith("tok_abc", "query", {
      query: CUSTOMER_ORDERS_QUERY,
      variables: { storeSlug: "my-store" },
    });
    expect(result.current.data).toEqual(data);
    expect(result.current.error).toBeNull();
  });

  it("useCustomerOrders does not refetch when re-rendered with an equal options literal", async () => {
    const ctx = createCustomerContext({ data: { onetimeOrders: [], subscriptionOrders: [] } });
    const { result, rerender } = renderHook(() => useCustomerOrders({ storeId: "STO_xxx" }), { wrapper: createWrapper(ctx) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(ctx.customerSessionAction).toHaveBeenCalledTimes(1);
  });

  it("useCustomerOrders exposes GraphQL errors as error", async () => {
    const ctx = createCustomerContext({ data: null, errors: [SCHEMA_ERROR] });
    const { result } = renderHook(() => useCustomerOrders({ storeId: "STO_xxx" }), { wrapper: createWrapper(ctx) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error?.message).toBe(SCHEMA_ERROR.message);
    expect(result.current.data).toBeNull();
  });

  it("useCustomerPayments sends storeId and unwraps the list", async () => {
    const payments = [{ id: "PAY_1", orderId: "ORD_1", status: "succeeded", amount: { amount: "999", currency: "USD", display: "9.99" } }];
    const ctx = createCustomerContext({ data: { payments } });
    const { result } = renderHook(() => useCustomerPayments({ storeId: "STO_xxx" }), { wrapper: createWrapper(ctx) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(ctx.customerSessionAction).toHaveBeenCalledWith("tok_abc", "query", {
      query: CUSTOMER_PAYMENTS_QUERY,
      variables: { storeId: "STO_xxx" },
    });
    expect(result.current.data).toEqual(payments);
  });

  it("useCustomerPayments keeps data null when the server sends null data", async () => {
    const ctx = createCustomerContext({ data: null });
    const { result } = renderHook(() => useCustomerPayments(), { wrapper: createWrapper(ctx) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("useCustomerRefundTickets exposes GraphQL errors as error", async () => {
    const ctx = createCustomerContext({ data: null, errors: [{ message: "Unauthorized" }] });
    const { result } = renderHook(() => useCustomerRefundTickets(), { wrapper: createWrapper(ctx) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error?.message).toBe("Unauthorized");
    expect(result.current.data).toBeNull();
  });
});

describe("merchant data hooks", () => {
  it("useMerchantOrders sends a String storeId and returns data", async () => {
    const data = { onetimeOrders: [], subscriptionOrders: [] };
    const query = createMerchantQuery({ data });
    const { result } = renderHook(() => useMerchantOrders(query, { storeId: "STO_xxx" }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(query).toHaveBeenCalledWith({ query: MERCHANT_ORDERS_QUERY, variables: { storeId: "STO_xxx", limit: 20 } });
    expect(result.current.data).toEqual(data);
  });

  it("useMerchantOrders exposes GraphQL errors as error", async () => {
    const query = createMerchantQuery({ data: null, errors: [SCHEMA_ERROR] });
    const { result } = renderHook(() => useMerchantOrders(query, { storeId: "STO_xxx" }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error?.message).toBe(SCHEMA_ERROR.message);
  });

  it("useMerchantSales sends the analytics filter and maps the statistics", async () => {
    const query = createMerchantQuery({
      data: {
        orderStatistics: {
          totalCount: 7,
          countsByStatus: [{ status: "completed", count: 7 }],
          revenueByCurrency: [
            { currency: "EUR", snapshotTotalAmount: "5.00" },
            { currency: "USD", snapshotTotalAmount: "69.93" },
          ],
          revenueByPeriod: [{ period: "2026-10-01", snapshotTotalAmount: "69.93" }],
          buyerMetrics: { totalBuyers: 3 },
        },
      },
    });
    const { result } = renderHook(() =>
      useMerchantSales(query, { storeId: "STO_xxx", startDate: "2026-10-01", endDate: "2026-11-01", currency: "USD" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(query).toHaveBeenCalledWith({
      query: MERCHANT_SALES_QUERY,
      variables: {
        storeId: "STO_xxx",
        filter: { timeRange: { startDate: "2026-10-01", endDate: "2026-11-01" } },
        granularity: "DAY",
        currency: "USD",
      },
    });
    expect(result.current.data).toEqual({
      totalOrders: 7,
      totalRevenue: "69.93",
      totalCustomers: 3,
      currency: "USD",
      ordersByStatus: [{ status: "completed", count: 7 }],
      revenueByPeriod: [{ period: "2026-10-01", amount: "69.93" }],
    });
  });

  it("useMerchantSales reports zero revenue when the currency has no payments", async () => {
    const query = createMerchantQuery({
      data: {
        orderStatistics: {
          totalCount: 0,
          countsByStatus: [],
          revenueByCurrency: [],
          revenueByPeriod: [],
          buyerMetrics: { totalBuyers: 0 },
        },
      },
    });
    const { result } = renderHook(() =>
      useMerchantSales(query, {
        storeId: "STO_xxx",
        startDate: "2026-10-01",
        endDate: "2026-11-01",
        currency: "JPY",
        granularity: "MONTH",
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.totalRevenue).toBe("0");
    expect(vi.mocked(query).mock.calls[0][0].variables).toMatchObject({ granularity: "MONTH", currency: "JPY" });
  });

  it("useMerchantSales exposes GraphQL errors instead of reading null data", async () => {
    const message = 'Field "orderStatistics" argument "filter" of type "AnalyticsFilterInput!" is required, but it was not provided.';
    const query = createMerchantQuery({ data: null, errors: [{ message }] });
    const { result } = renderHook(() =>
      useMerchantSales(query, { storeId: "STO_xxx", startDate: "2026-10-01", endDate: "2026-11-01", currency: "USD" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error?.message).toBe(message);
    expect(result.current.data).toBeNull();
  });

  it("useMerchantSales keeps data null when the statistics are null", async () => {
    const query = createMerchantQuery({ data: { orderStatistics: null } });
    const { result } = renderHook(() =>
      useMerchantSales(query, { storeId: "STO_xxx", startDate: "2026-10-01", endDate: "2026-11-01", currency: "USD" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
  });

  it("useMerchantSubscriptions counts statuses", async () => {
    const subscriptionOrders = [
      { status: "active" },
      { status: "active" },
      { status: "canceling" },
      { status: "past_due" },
      { status: "canceled" },
    ];
    const query = createMerchantQuery({ data: { subscriptionOrders } });
    const { result } = renderHook(() => useMerchantSubscriptions(query, "STO_xxx"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(query).toHaveBeenCalledWith({ query: MERCHANT_SUBSCRIPTIONS_QUERY, variables: { storeId: "STO_xxx" } });
    expect(result.current.data).toMatchObject({ activeCount: 2, cancelingCount: 1, pastDueCount: 1, totalCount: 5 });
  });

  it("useMerchantSubscriptions exposes GraphQL errors and tolerates null data", async () => {
    const failing = createMerchantQuery({ data: null, errors: [{ message: "Store not found" }] });
    const { result: failed } = renderHook(() => useMerchantSubscriptions(failing, "STO_xxx"));
    await waitFor(() => expect(failed.current.isLoading).toBe(false));
    expect(failed.current.error?.message).toBe("Store not found");

    const empty = createMerchantQuery({ data: null });
    const { result: none } = renderHook(() => useMerchantSubscriptions(empty, "STO_xxx"));
    await waitFor(() => expect(none.current.isLoading).toBe(false));
    expect(none.current.error).toBeNull();
    expect(none.current.data).toBeNull();
  });
});

describe("useQuery", () => {
  /** A promise whose settlement the test controls. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("clears data when a refetch fails", async () => {
    let fail = false;
    const queryFn = vi.fn(() => (fail ? Promise.reject(new Error("boom")) : Promise.resolve({ n: 1 })));
    const { result } = renderHook(() => useQuery(queryFn, true));

    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    fail = true;
    act(() => result.current.refetch());

    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("wraps a non-Error rejection", async () => {
    const queryFn = () => Promise.reject("nope");
    const { result } = renderHook(() => useQuery(queryFn, true));

    await waitFor(() => expect(result.current.error).toEqual(new Error("nope")));
    expect(result.current.data).toBeNull();
  });

  it("discards a response that arrives after the parameters changed", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(({ fn }) => useQuery(fn, true), {
      initialProps: { fn: () => first.promise },
    });

    rerender({ fn: () => second.promise });
    await act(async () => second.resolve("store B"));
    expect(result.current.data).toBe("store B");
    expect(result.current.isLoading).toBe(false);

    await act(async () => first.resolve("store A"));
    expect(result.current.data).toBe("store B");
  });

  it("discards a late failure of a superseded request", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(({ fn }) => useQuery(fn, true), {
      initialProps: { fn: () => first.promise },
    });

    rerender({ fn: () => second.promise });
    await act(async () => second.resolve("store B"));
    await act(async () => first.reject(new Error("store A failed")));

    expect(result.current.data).toBe("store B");
    expect(result.current.error).toBeNull();
  });

  it("does not fetch until ready", () => {
    const queryFn = vi.fn(() => Promise.resolve("x"));
    const { result } = renderHook(() => useQuery(queryFn, false));

    expect(queryFn).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true);
  });
});
