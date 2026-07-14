import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, it, expect, vi } from "vitest";

import { WaffoPancakeProvider, usePancakeContext } from "../provider.js";
import { createBuyerSessionAction, createBuyerTokenAction, createCustomerSessionAction, createCustomerTokenAction } from "../server.js";
import {
  useBuyerOrders,
  useBuyerPayments,
  useBuyerRefundTickets,
  useCustomerOrders,
  useCustomerPayments,
  useCustomerRefundTickets,
} from "../use-customer-data.js";
import { useBuyer, useCustomer } from "../use-customer.js";

import type { BuyerConfig } from "../provider.js";
import type { BuyerTokenAction, BuyerSessionAction } from "../server.js";

function createLegacyBuyerConfig(): BuyerConfig {
  const issueToken: BuyerTokenAction = vi.fn().mockResolvedValue({
    token: "tok_legacy",
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
  });

  const sessionAction: BuyerSessionAction = vi.fn().mockResolvedValue({ data: {} });

  return {
    identity: "legacy@example.com",
    storeId: "STO_xxx",
    issueToken,
    sessionAction,
  };
}

describe("deprecated aliases", () => {
  it("should alias the old buyer names to the customer implementations", () => {
    expect(useBuyer).toBe(useCustomer);
    expect(useBuyerOrders).toBe(useCustomerOrders);
    expect(useBuyerPayments).toBe(useCustomerPayments);
    expect(useBuyerRefundTickets).toBe(useCustomerRefundTickets);
    expect(createBuyerTokenAction).toBe(createCustomerTokenAction);
    expect(createBuyerSessionAction).toBe(createCustomerSessionAction);
  });

  it("should support the deprecated `buyer` provider prop and useBuyer hook", async () => {
    const legacy = createLegacyBuyerConfig();

    const wrapper = ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider buyer={legacy}>{children}</WaffoPancakeProvider>;

    const { result: ctx } = renderHook(() => usePancakeContext(), { wrapper });
    const { result: hook } = renderHook(() => useBuyer(), { wrapper });

    await waitFor(() => {
      expect(ctx.current.isCustomerReady).toBe(true);
    });

    expect(legacy.issueToken).toHaveBeenCalledWith({
      buyerIdentity: "legacy@example.com",
      storeId: "STO_xxx",
      productId: undefined,
    });
    expect(typeof hook.current.cancelSubscription.execute).toBe("function");
    expect(typeof hook.current.query).toBe("function");
  });
});
