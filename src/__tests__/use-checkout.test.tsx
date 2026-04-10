import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { useCheckout } from "../use-checkout.js";

import type { WaffoPancake } from "@waffo/pancake-ts";

function createMockClient(overrides?: { anonymous?: () => Promise<unknown>; authenticated?: () => Promise<unknown> }) {
  return {
    checkout: {
      anonymous: {
        create: overrides?.anonymous ?? vi.fn().mockResolvedValue({ sessionId: "cs_123", checkoutUrl: "https://checkout.example.com/cs_123", expiresAt: "2026-04-10T12:00:00Z" }),
      },
      authenticated: {
        create: overrides?.authenticated ?? vi.fn().mockResolvedValue({ sessionId: "cs_456", checkoutUrl: "https://checkout.example.com/cs_456#token=tok_abc", expiresAt: "2026-04-10T12:00:00Z", token: "tok_abc", tokenExpiresAt: "2026-04-10T12:30:00Z" }),
      },
    },
  } as unknown as WaffoPancake;
}

describe("useCheckout", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, href: "http://localhost" },
    });
  });

  it("should return initial state", () => {
    const client = createMockClient();
    const { result } = renderHook(() =>
      useCheckout({ client, params: { productId: "PROD_xxx", currency: "USD" } }),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.checkout).toBe("function");
  });

  it("should redirect on anonymous checkout (default mode)", async () => {
    const client = createMockClient();
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useCheckout({ client, params: { productId: "PROD_xxx", currency: "USD" }, onSuccess }),
    );

    await act(async () => {
      result.current.checkout();
      // Wait for async
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(window.location.href).toBe("https://checkout.example.com/cs_123");
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "cs_123" }));
  });

  it("should redirect on authenticated checkout", async () => {
    const client = createMockClient();
    const { result } = renderHook(() =>
      useCheckout({
        client,
        params: { productId: "PROD_xxx", currency: "USD", buyerIdentity: "user@example.com" },
        type: "authenticated",
      }),
    );

    await act(async () => {
      result.current.checkout();
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(window.location.href).toBe("https://checkout.example.com/cs_456#token=tok_abc");
  });

  it("should open popup in popup mode", async () => {
    const mockPopup = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(mockPopup as unknown as Window);

    const client = createMockClient();
    const { result } = renderHook(() =>
      useCheckout({ client, params: { productId: "PROD_xxx", currency: "USD" }, mode: "popup" }),
    );

    await act(async () => {
      result.current.checkout();
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(window.open).toHaveBeenCalledWith(expect.any(String), "_blank");
    expect(mockPopup.location.href).toBe("https://checkout.example.com/cs_123");
  });

  it("should close popup on error", async () => {
    const mockPopup = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(mockPopup as unknown as Window);

    const client = createMockClient({
      anonymous: vi.fn().mockRejectedValue(new Error("API error")),
    });
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useCheckout({ client, params: { productId: "PROD_xxx", currency: "USD" }, mode: "popup", onError }),
    );

    await act(async () => {
      result.current.checkout();
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(mockPopup.close).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(result.current.error?.message).toBe("API error");
  });

  it("should set isLoading during checkout", async () => {
    let resolveCreate: (value: unknown) => void;
    const client = createMockClient({
      anonymous: () => new Promise((r) => { resolveCreate = r; }),
    });

    const { result } = renderHook(() =>
      useCheckout({ client, params: { productId: "PROD_xxx", currency: "USD" } }),
    );

    expect(result.current.isLoading).toBe(false);

    act(() => {
      result.current.checkout();
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveCreate!({ sessionId: "cs_789", checkoutUrl: "https://checkout.example.com/cs_789", expiresAt: "2026-04-10T12:00:00Z" });
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.isLoading).toBe(false);
  });
});
