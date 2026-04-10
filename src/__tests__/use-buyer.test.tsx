import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { useBuyer } from "../use-buyer.js";

import type { WaffoPancake } from "@waffo/pancake-ts";

function createMockClient() {
  const buyerSession = {
    cancelSubscription: vi.fn().mockResolvedValue({ orderId: "ORD_xxx", status: "canceling" }),
    cancelOnetimeOrder: vi.fn().mockResolvedValue({ orderId: "ORD_yyy", status: "canceled" }),
    reactivateSubscription: vi.fn().mockResolvedValue({ orderId: "ORD_xxx", status: "active" }),
    createRefundTicket: vi.fn().mockResolvedValue({ ticket: { id: "TKT_xxx", status: "pending" } }),
    resubmitRefundTicket: vi.fn().mockResolvedValue({ ticket: { id: "TKT_xxx", status: "pending" } }),
    graphql: {
      query: vi.fn().mockResolvedValue({ data: { orders: [] } }),
    },
  };

  const client = {
    buyer: vi.fn().mockReturnValue(buyerSession),
  } as unknown as WaffoPancake;

  return { client, buyerSession };
}

describe("useBuyer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should create buyer session from client and token", () => {
    const { client } = createMockClient();
    renderHook(() => useBuyer(client, "tok_abc"));

    expect(client.buyer).toHaveBeenCalledWith("tok_abc");
  });

  it("should provide initial state for all actions", () => {
    const { client } = createMockClient();
    const { result } = renderHook(() => useBuyer(client, "tok_abc"));

    expect(result.current.cancelSubscription.isLoading).toBe(false);
    expect(result.current.cancelSubscription.error).toBeNull();
    expect(result.current.cancelSubscription.data).toBeNull();

    expect(result.current.cancelOnetimeOrder.isLoading).toBe(false);
    expect(result.current.reactivateSubscription.isLoading).toBe(false);
    expect(result.current.createRefundTicket.isLoading).toBe(false);
    expect(result.current.resubmitRefundTicket.isLoading).toBe(false);
  });

  it("should execute cancelSubscription and return data", async () => {
    const { client, buyerSession } = createMockClient();
    const { result } = renderHook(() => useBuyer(client, "tok_abc"));

    await act(async () => {
      await result.current.cancelSubscription.execute({ orderId: "ORD_xxx" });
    });

    expect(buyerSession.cancelSubscription).toHaveBeenCalledWith({ orderId: "ORD_xxx" });
    expect(result.current.cancelSubscription.data).toEqual({ orderId: "ORD_xxx", status: "canceling" });
    expect(result.current.cancelSubscription.isLoading).toBe(false);
  });

  it("should execute cancelOnetimeOrder and return data", async () => {
    const { client, buyerSession } = createMockClient();
    const { result } = renderHook(() => useBuyer(client, "tok_abc"));

    await act(async () => {
      await result.current.cancelOnetimeOrder.execute({ orderId: "ORD_yyy" });
    });

    expect(buyerSession.cancelOnetimeOrder).toHaveBeenCalledWith({ orderId: "ORD_yyy" });
    expect(result.current.cancelOnetimeOrder.data).toEqual({ orderId: "ORD_yyy", status: "canceled" });
  });

  it("should execute reactivateSubscription", async () => {
    const { client, buyerSession } = createMockClient();
    const { result } = renderHook(() => useBuyer(client, "tok_abc"));

    await act(async () => {
      await result.current.reactivateSubscription.execute({ orderId: "ORD_xxx" });
    });

    expect(buyerSession.reactivateSubscription).toHaveBeenCalledWith({ orderId: "ORD_xxx" });
    expect(result.current.reactivateSubscription.data).toEqual({ orderId: "ORD_xxx", status: "active" });
  });

  it("should execute createRefundTicket and unwrap ticket", async () => {
    const { client, buyerSession } = createMockClient();
    const { result } = renderHook(() => useBuyer(client, "tok_abc"));

    await act(async () => {
      await result.current.createRefundTicket.execute({
        paymentId: "PAY_xxx",
        reason: "Not as described",
        requestedAmount: { amount: "29.00", currency: "USD" },
      });
    });

    expect(buyerSession.createRefundTicket).toHaveBeenCalled();
    // Should unwrap { ticket: ... } to just the ticket
    expect(result.current.createRefundTicket.data).toEqual({ id: "TKT_xxx", status: "pending" });
  });

  it("should execute resubmitRefundTicket and unwrap ticket", async () => {
    const { client, buyerSession } = createMockClient();
    const { result } = renderHook(() => useBuyer(client, "tok_abc"));

    await act(async () => {
      await result.current.resubmitRefundTicket.execute({
        ticketId: "TKT_xxx",
        paymentId: "PAY_xxx",
        reason: "Updated reason",
        requestedAmount: { amount: "29.00", currency: "USD" },
      });
    });

    expect(buyerSession.resubmitRefundTicket).toHaveBeenCalled();
    expect(result.current.resubmitRefundTicket.data).toEqual({ id: "TKT_xxx", status: "pending" });
  });

  it("should execute GraphQL query", async () => {
    const { client, buyerSession } = createMockClient();
    const { result } = renderHook(() => useBuyer(client, "tok_abc"));

    let queryResult: unknown;
    await act(async () => {
      queryResult = await result.current.query({ query: "{ orders { id } }" });
    });

    expect(buyerSession.graphql.query).toHaveBeenCalledWith({ query: "{ orders { id } }" });
    expect(queryResult).toEqual({ data: { orders: [] } });
  });

  it("should handle errors and set error state", async () => {
    const { client, buyerSession } = createMockClient();
    buyerSession.cancelSubscription.mockRejectedValue(new Error("Order not found"));

    const { result } = renderHook(() => useBuyer(client, "tok_abc"));

    await act(async () => {
      try {
        await result.current.cancelSubscription.execute({ orderId: "ORD_xxx" });
      } catch {
        // expected
      }
    });

    expect(result.current.cancelSubscription.error?.message).toBe("Order not found");
    expect(result.current.cancelSubscription.isLoading).toBe(false);
    expect(result.current.cancelSubscription.data).toBeNull();
  });

  it("should set isLoading during execution", async () => {
    let resolveAction: (value: unknown) => void;
    const { client, buyerSession } = createMockClient();
    buyerSession.cancelSubscription.mockImplementation(
      () => new Promise((r) => { resolveAction = r; }),
    );

    const { result } = renderHook(() => useBuyer(client, "tok_abc"));

    expect(result.current.cancelSubscription.isLoading).toBe(false);

    let executePromise: Promise<void>;
    act(() => {
      executePromise = result.current.cancelSubscription.execute({ orderId: "ORD_xxx" });
    });

    expect(result.current.cancelSubscription.isLoading).toBe(true);

    await act(async () => {
      resolveAction!({ orderId: "ORD_xxx", status: "canceling" });
      await executePromise!;
    });

    expect(result.current.cancelSubscription.isLoading).toBe(false);
  });
});
