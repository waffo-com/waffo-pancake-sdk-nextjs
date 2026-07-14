import { renderHook, render, screen, act, waitFor } from "@testing-library/react";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { WaffoPancakeProvider, usePancakeContext, PancakeContext } from "../provider.js";

import type { CustomerConfig } from "../provider.js";
import type { CustomerTokenAction, CustomerSessionAction } from "../server.js";

function createMockCustomerConfig(overrides?: Partial<CustomerConfig>): CustomerConfig {
  const issueToken: CustomerTokenAction = vi.fn().mockResolvedValue({
    token: "tok_initial",
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
  });

  const sessionAction: CustomerSessionAction = vi.fn().mockResolvedValue({ data: {} });

  return {
    identity: "customer@example.com",
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
    const customer = createMockCustomerConfig();

    render(
      <WaffoPancakeProvider customer={customer}>
        <div data-testid="child">Hello</div>
      </WaffoPancakeProvider>,
    );

    expect(screen.getByTestId("child")).toBeDefined();
    expect(screen.getByTestId("child").textContent).toBe("Hello");
  });

  it("should issue initial token on mount", async () => {
    const customer = createMockCustomerConfig();

    renderHook(() => usePancakeContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider customer={customer}>{children}</WaffoPancakeProvider>,
    });

    await waitFor(() => {
      expect(customer.issueToken).toHaveBeenCalledWith({
        buyerIdentity: "customer@example.com",
        storeId: "STO_xxx",
        productId: undefined,
      });
    });
  });

  it("should pass productId when provided", async () => {
    const customer = createMockCustomerConfig({ productId: "PROD_abc", storeId: undefined });

    renderHook(() => usePancakeContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider customer={customer}>{children}</WaffoPancakeProvider>,
    });

    await waitFor(() => {
      expect(customer.issueToken).toHaveBeenCalledWith({
        buyerIdentity: "customer@example.com",
        storeId: undefined,
        productId: "PROD_abc",
      });
    });
  });

  it("should set isCustomerReady to true after successful token issuance", async () => {
    const customer = createMockCustomerConfig();

    const { result } = renderHook(() => usePancakeContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider customer={customer}>{children}</WaffoPancakeProvider>,
    });

    await waitFor(() => {
      expect(result.current.isCustomerReady).toBe(true);
    });
  });

  it("should set isCustomerReady to true even when token issuance fails", async () => {
    const customer = createMockCustomerConfig({
      issueToken: vi.fn().mockRejectedValue(new Error("Network error")),
    });

    const { result } = renderHook(() => usePancakeContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider customer={customer}>{children}</WaffoPancakeProvider>,
    });

    await waitFor(() => {
      expect(result.current.isCustomerReady).toBe(true);
    });
  });

  it("should expose hasCustomer as true", async () => {
    const customer = createMockCustomerConfig();

    const { result } = renderHook(() => usePancakeContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider customer={customer}>{children}</WaffoPancakeProvider>,
    });

    expect(result.current.hasCustomer).toBe(true);
  });

  it("should expose customerSessionAction from config", async () => {
    const customer = createMockCustomerConfig();

    const { result } = renderHook(() => usePancakeContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <WaffoPancakeProvider customer={customer}>{children}</WaffoPancakeProvider>,
    });

    expect(result.current.customerSessionAction).toBe(customer.sessionAction);
  });

  describe("getCustomerToken", () => {
    it("should return cached token when not expired", async () => {
      const customer = createMockCustomerConfig();

      const { result } = renderHook(() => usePancakeContext(), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <WaffoPancakeProvider customer={customer}>{children}</WaffoPancakeProvider>
        ),
      });

      // Wait for initial token to be issued
      await waitFor(() => {
        expect(result.current.isCustomerReady).toBe(true);
      });

      // getCustomerToken should return cached token without calling issueToken again
      let token: string | undefined;
      await act(async () => {
        token = await result.current.getCustomerToken();
      });

      expect(token).toBe("tok_initial");
      // issueToken called once on mount, not again
      expect(customer.issueToken).toHaveBeenCalledTimes(1);
    });

    it("should refresh token when expired (past buffer)", async () => {
      // First call returns a token that is about to expire (within 30s buffer)
      const issueToken = vi
        .fn<CustomerTokenAction>()
        .mockResolvedValueOnce({
          token: "tok_expired",
          expiresAt: new Date(Date.now() + 10_000).toISOString(), // expires in 10s, within 30s buffer
        })
        .mockResolvedValueOnce({
          token: "tok_refreshed",
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        });

      const customer = createMockCustomerConfig({ issueToken });

      const { result } = renderHook(() => usePancakeContext(), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <WaffoPancakeProvider customer={customer}>{children}</WaffoPancakeProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isCustomerReady).toBe(true);
      });

      // Token is within buffer, should trigger refresh
      let token: string | undefined;
      await act(async () => {
        token = await result.current.getCustomerToken();
      });

      expect(token).toBe("tok_refreshed");
      expect(issueToken).toHaveBeenCalledTimes(2);
    });

    it("should deduplicate concurrent refresh calls", async () => {
      let resolveSecond: ((value: { token: string; expiresAt: string }) => void) | undefined;

      const issueToken = vi
        .fn<CustomerTokenAction>()
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

      const customer = createMockCustomerConfig({ issueToken });

      const { result } = renderHook(() => usePancakeContext(), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <WaffoPancakeProvider customer={customer}>{children}</WaffoPancakeProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isCustomerReady).toBe(true);
      });

      // Fire two concurrent calls — both should share the same refresh promise
      let token1: string | undefined;
      let token2: string | undefined;

      await act(async () => {
        const p1 = result.current.getCustomerToken();
        const p2 = result.current.getCustomerToken();

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
      getCustomerToken: vi.fn().mockResolvedValue("tok_abc"),
      customerSessionAction: vi.fn(),
      hasCustomer: true,
      isCustomerReady: true,
    };

    const { result } = renderHook(() => usePancakeContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <PancakeContext.Provider value={mockValue}>{children}</PancakeContext.Provider>
      ),
    });

    expect(result.current.hasCustomer).toBe(true);
    expect(result.current.isCustomerReady).toBe(true);
    expect(result.current.getCustomerToken).toBe(mockValue.getCustomerToken);
  });
});
