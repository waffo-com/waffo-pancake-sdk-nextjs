import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, it, expect, vi } from "vitest";

import { WaffoPancakeProvider, usePancakeContext } from "../provider.js";
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
  it("should alias useBuyer to useCustomer", () => {
    expect(useBuyer).toBe(useCustomer);
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
