import { renderHook, render, screen, act, waitFor } from "@testing-library/react";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { WaffoPancakeProvider, usePancakeContext, PancakeContext } from "../provider.js";

import type { BuyerConfig } from "../provider.js";
import type { BuyerTokenAction, BuyerSessionAction } from "../server.js";

function createMockBuyerConfig(overrides?: Partial<BuyerConfig>): BuyerConfig {
  const issueToken: BuyerTokenAction = vi.fn().mockResolvedValue({
    token: "tok_initial",
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
  });

  const sessionAction: BuyerSessionAction = vi.fn().mockResolvedValue({ data: {} });

  return {
    identity: "buyer@example.com",
    storeId: "STO_xxx",
    issueToken,
    sessionAction,
    ...overrides,
  };
}

describe("WaffoPancakeProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should render children", async () => {
    const buyer = createMockBuyerConfig();

    render(
      <WaffoPancakeProvider buyer={buyer}>
        <div data-testid="child">Hello</div>
      </WaffoPancakeProvider>,
    );

    expect(screen.getByTestId("child")).toBeDefined();
    expect(screen.getByTestId("child").textContent).toBe("Hello");
  });

  it("should issue initial token on mount", async () => {
    const buyer = createMockBuyerConfig();

    renderHook(() => usePancakeContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider buyer={buyer}>{children}</WaffoPancakeProvider>,
    });

    await waitFor(() => {
      expect(buyer.issueToken).toHaveBeenCalledWith({
        buyerIdentity: "buyer@example.com",
        storeId: "STO_xxx",
        productId: undefined,
      });
    });
  });

  it("should pass productId when provided", async () => {
    const buyer = createMockBuyerConfig({ productId: "PROD_abc", storeId: undefined });

    renderHook(() => usePancakeContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider buyer={buyer}>{children}</WaffoPancakeProvider>,
    });

    await waitFor(() => {
      expect(buyer.issueToken).toHaveBeenCalledWith({
        buyerIdentity: "buyer@example.com",
        storeId: undefined,
        productId: "PROD_abc",
      });
    });
  });

  it("should set isBuyerReady to true after successful token issuance", async () => {
    const buyer = createMockBuyerConfig();

    const { result } = renderHook(() => usePancakeContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider buyer={buyer}>{children}</WaffoPancakeProvider>,
    });

    await waitFor(() => {
      expect(result.current.isBuyerReady).toBe(true);
    });
  });

  it("should set isBuyerReady to true even when token issuance fails", async () => {
    const buyer = createMockBuyerConfig({
      issueToken: vi.fn().mockRejectedValue(new Error("Network error")),
    });

    const { result } = renderHook(() => usePancakeContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider buyer={buyer}>{children}</WaffoPancakeProvider>,
    });

    await waitFor(() => {
      expect(result.current.isBuyerReady).toBe(true);
    });
  });

  it("should expose hasBuyer as true", async () => {
    const buyer = createMockBuyerConfig();

    const { result } = renderHook(() => usePancakeContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider buyer={buyer}>{children}</WaffoPancakeProvider>,
    });

    expect(result.current.hasBuyer).toBe(true);
  });

  it("should expose buyerSessionAction from config", async () => {
    const buyer = createMockBuyerConfig();

    const { result } = renderHook(() => usePancakeContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider buyer={buyer}>{children}</WaffoPancakeProvider>,
    });

    expect(result.current.buyerSessionAction).toBe(buyer.sessionAction);
  });

  describe("getBuyerToken", () => {
    it("should return cached token when not expired", async () => {
      const buyer = createMockBuyerConfig();

      const { result } = renderHook(() => usePancakeContext(), {
        wrapper: ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider buyer={buyer}>{children}</WaffoPancakeProvider>,
      });

      // Wait for initial token to be issued
      await waitFor(() => {
        expect(result.current.isBuyerReady).toBe(true);
      });

      // getBuyerToken should return cached token without calling issueToken again
      let token: string | undefined;
      await act(async () => {
        token = await result.current.getBuyerToken();
      });

      expect(token).toBe("tok_initial");
      // issueToken called once on mount, not again
      expect(buyer.issueToken).toHaveBeenCalledTimes(1);
    });

    it("should refresh token when expired (past buffer)", async () => {
      // First call returns a token that is about to expire (within 30s buffer)
      const issueToken = vi
        .fn<BuyerTokenAction>()
        .mockResolvedValueOnce({
          token: "tok_expired",
          expiresAt: new Date(Date.now() + 10_000).toISOString(), // expires in 10s, within 30s buffer
        })
        .mockResolvedValueOnce({
          token: "tok_refreshed",
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        });

      const buyer = createMockBuyerConfig({ issueToken });

      const { result } = renderHook(() => usePancakeContext(), {
        wrapper: ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider buyer={buyer}>{children}</WaffoPancakeProvider>,
      });

      await waitFor(() => {
        expect(result.current.isBuyerReady).toBe(true);
      });

      // Token is within buffer, should trigger refresh
      let token: string | undefined;
      await act(async () => {
        token = await result.current.getBuyerToken();
      });

      expect(token).toBe("tok_refreshed");
      expect(issueToken).toHaveBeenCalledTimes(2);
    });

    it("should deduplicate concurrent refresh calls", async () => {
      let resolveSecond: ((value: { token: string; expiresAt: string }) => void) | undefined;

      const issueToken = vi
        .fn<BuyerTokenAction>()
        .mockResolvedValueOnce({
          token: "tok_expired",
          expiresAt: new Date(Date.now() - 60_000).toISOString(), // already expired
        })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecond = resolve;
            }),
        );

      const buyer = createMockBuyerConfig({ issueToken });

      const { result } = renderHook(() => usePancakeContext(), {
        wrapper: ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider buyer={buyer}>{children}</WaffoPancakeProvider>,
      });

      await waitFor(() => {
        expect(result.current.isBuyerReady).toBe(true);
      });

      // Fire two concurrent calls — both should share the same refresh promise
      let token1: string | undefined;
      let token2: string | undefined;

      await act(async () => {
        const p1 = result.current.getBuyerToken();
        const p2 = result.current.getBuyerToken();

        resolveSecond!({
          token: "tok_deduped",
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        });

        [token1, token2] = await Promise.all([p1, p2]);
      });

      expect(token1).toBe("tok_deduped");
      expect(token2).toBe("tok_deduped");
      // mount + one shared refresh = 2 calls total (not 3)
      expect(issueToken).toHaveBeenCalledTimes(2);
    });
  });
});

describe("usePancakeContext", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should throw when used outside provider", () => {
    expect(() => {
      renderHook(() => usePancakeContext());
    }).toThrow("must be used within <WaffoPancakeProvider>");
  });

  it("should return context when used inside provider", () => {
    const mockValue = {
      getBuyerToken: vi.fn().mockResolvedValue("tok_abc"),
      buyerSessionAction: vi.fn(),
      hasBuyer: true,
      isBuyerReady: true,
    };

    const { result } = renderHook(() => usePancakeContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <PancakeContext.Provider value={mockValue}>{children}</PancakeContext.Provider>
      ),
    });

    expect(result.current.hasBuyer).toBe(true);
    expect(result.current.isBuyerReady).toBe(true);
    expect(result.current.getBuyerToken).toBe(mockValue.getBuyerToken);
  });
});
