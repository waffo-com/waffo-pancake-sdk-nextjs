import { renderHook, act } from "@testing-library/react";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { PancakeContext } from "../provider.js";
import { useBuyer } from "../use-buyer.js";

import type { PancakeContextValue } from "../provider.js";

function createMockContext(): PancakeContextValue {
  const buyerSessionAction = vi.fn(async (_token: string, actionType: string) => {
    switch (actionType) {
      case "cancelSubscription":
        return { orderId: "ORD_xxx", status: "canceling" };
      case "cancelOnetimeOrder":
        return { orderId: "ORD_yyy", status: "canceled" };
      case "reactivateSubscription":
        return { orderId: "ORD_xxx", status: "active" };
      case "createRefundTicket":
        return { ticket: { id: "TKT_xxx", status: "pending" } };
      case "resubmitRefundTicket":
        return { ticket: { id: "TKT_xxx", status: "pending" } };
      case "query":
        return { data: { orders: [] } };
      default:
        throw new Error(`Unknown action: ${actionType}`);
    }
  });

  return {
    getBuyerToken: vi.fn().mockResolvedValue("tok_abc"),
    buyerSessionAction,
    hasBuyer: true,
    isBuyerReady: true,
  };
}

function createWrapper(ctx: PancakeContextValue) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <PancakeContext.Provider value={ctx}>{children}</PancakeContext.Provider>;
  };
}

describe("useBuyer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should provide initial state for all actions", () => {
    const ctx = createMockContext();
    const { result } = renderHook(() => useBuyer(), { wrapper: createWrapper(ctx) });

    expect(result.current.cancelSubscription.isLoading).toBe(false);
    expect(result.current.cancelSubscription.error).toBeNull();
    expect(result.current.cancelSubscription.data).toBeNull();
    expect(result.current.cancelOnetimeOrder.isLoading).toBe(false);
    expect(result.current.reactivateSubscription.isLoading).toBe(false);
    expect(result.current.createRefundTicket.isLoading).toBe(false);
    expect(result.current.resubmitRefundTicket.isLoading).toBe(false);
  });

  it("should execute cancelSubscription via server action", async () => {
    const ctx = createMockContext();
    const { result } = renderHook(() => useBuyer(), { wrapper: createWrapper(ctx) });

    await act(async () => {
      await result.current.cancelSubscription.execute({ orderId: "ORD_xxx" });
    });

    expect(ctx.getBuyerToken).toHaveBeenCalled();
    expect(ctx.buyerSessionAction).toHaveBeenCalledWith("tok_abc", "cancelSubscription", { orderId: "ORD_xxx" });
    expect(result.current.cancelSubscription.data).toEqual({ orderId: "ORD_xxx", status: "canceling" });
  });

  it("should execute cancelOnetimeOrder", async () => {
    const ctx = createMockContext();
    const { result } = renderHook(() => useBuyer(), { wrapper: createWrapper(ctx) });

    await act(async () => {
      await result.current.cancelOnetimeOrder.execute({ orderId: "ORD_yyy" });
    });

    expect(ctx.buyerSessionAction).toHaveBeenCalledWith("tok_abc", "cancelOnetimeOrder", { orderId: "ORD_yyy" });
    expect(result.current.cancelOnetimeOrder.data).toEqual({ orderId: "ORD_yyy", status: "canceled" });
  });

  it("should execute reactivateSubscription", async () => {
    const ctx = createMockContext();
    const { result } = renderHook(() => useBuyer(), { wrapper: createWrapper(ctx) });

    await act(async () => {
      await result.current.reactivateSubscription.execute({ orderId: "ORD_xxx" });
    });

    expect(result.current.reactivateSubscription.data).toEqual({ orderId: "ORD_xxx", status: "active" });
  });

  it("should execute createRefundTicket and unwrap ticket", async () => {
    const ctx = createMockContext();
    const { result } = renderHook(() => useBuyer(), { wrapper: createWrapper(ctx) });

    await act(async () => {
      await result.current.createRefundTicket.execute({
        paymentId: "PAY_xxx",
        reason: "Not as described",
        requestedAmount: { amount: "29.00", currency: "USD" },
      });
    });

    expect(result.current.createRefundTicket.data).toEqual({ id: "TKT_xxx", status: "pending" });
  });

  it("should forward refundTicketMerchantExternalId to the server action", async () => {
    const ctx = createMockContext();
    const { result } = renderHook(() => useBuyer(), { wrapper: createWrapper(ctx) });

    await act(async () => {
      await result.current.createRefundTicket.execute({
        paymentId: "PAY_xxx",
        reason: "Not as described",
        requestedAmount: { amount: "29.00", currency: "USD" },
        refundTicketMerchantExternalId: "REF-2026-00891",
      });
    });

    expect(ctx.buyerSessionAction).toHaveBeenCalledWith(
      "tok_abc",
      "createRefundTicket",
      expect.objectContaining({ refundTicketMerchantExternalId: "REF-2026-00891" }),
    );
  });

  it("should execute GraphQL query", async () => {
    const ctx = createMockContext();
    const { result } = renderHook(() => useBuyer(), { wrapper: createWrapper(ctx) });

    let queryResult: unknown;
    await act(async () => {
      queryResult = await result.current.query({ query: "{ orders { id } }" });
    });

    expect(ctx.buyerSessionAction).toHaveBeenCalledWith("tok_abc", "query", { query: "{ orders { id } }" });
    expect(queryResult).toEqual({ data: { orders: [] } });
  });

  it("should handle errors", async () => {
    const ctx = createMockContext();
    (ctx.buyerSessionAction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Order not found"));

    const { result } = renderHook(() => useBuyer(), { wrapper: createWrapper(ctx) });

    await act(async () => {
      try {
        await result.current.cancelSubscription.execute({ orderId: "ORD_xxx" });
      } catch {
        // expected
      }
    });

    expect(result.current.cancelSubscription.error?.message).toBe("Order not found");
    expect(result.current.cancelSubscription.data).toBeNull();
  });

  it("should throw when used outside provider", () => {
    expect(() => {
      renderHook(() => useBuyer());
    }).toThrow("must be used within <WaffoPancakeProvider>");
  });
});
