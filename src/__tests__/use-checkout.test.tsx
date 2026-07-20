import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { useCheckout } from "../use-checkout.js";

import type { CheckoutAction } from "../server.js";

function createMockAction(overrides?: { result?: unknown; error?: Error }): CheckoutAction {
  if (overrides?.error) {
    return vi.fn().mockRejectedValue(overrides.error);
  }
  return vi.fn().mockResolvedValue(
    overrides?.result ?? {
      sessionId: "cs_123",
      checkoutUrl: "https://checkout.example.com/cs_123",
      expiresAt: "2026-04-10T12:00:00Z",
    },
  );
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

  describe("link checkout", () => {
    it("should redirect to product page URL", () => {
      const { result } = renderHook(() =>
        useCheckout({
          type: "link",
          storeSlug: "my-store",
          productId: "PROD_xxx",
          currency: "USD",
        }),
      );

      act(() => {
        result.current.checkout();
      });

      expect(window.location.href).toBe("https://pancake.waffo.ai/store/my-store/product/PROD_xxx?currency=USD");
      expect(result.current.isLoading).toBe(false);
    });

    it("should include all optional params in URL", () => {
      const { result } = renderHook(() =>
        useCheckout({
          type: "link",
          storeSlug: "my-store",
          productId: "PROD_xxx",
          currency: "JPY",
          email: "customer@example.com",
          successUrl: "https://example.com/success",
          test: true,
          country: "JP",
          isBusiness: true,
        }),
      );

      act(() => {
        result.current.checkout();
      });

      const url = new URL(window.location.href);
      expect(url.pathname).toBe("/store/my-store/product/PROD_xxx");
      expect(url.searchParams.get("currency")).toBe("JPY");
      expect(url.searchParams.get("email")).toBe("customer@example.com");
      expect(url.searchParams.get("success_url")).toBe("https://example.com/success");
      expect(url.searchParams.get("test")).toBe("true");
      expect(url.searchParams.get("country")).toBe("JP");
      expect(url.searchParams.get("is_business")).toBe("true");
    });

    it("should open popup in popup mode", () => {
      vi.spyOn(window, "open").mockReturnValue(null);

      const { result } = renderHook(() =>
        useCheckout({
          type: "link",
          storeSlug: "my-store",
          productId: "PROD_xxx",
          currency: "USD",
          mode: "popup",
        }),
      );

      act(() => {
        result.current.checkout();
      });

      expect(window.open).toHaveBeenCalledWith("https://pancake.waffo.ai/store/my-store/product/PROD_xxx?currency=USD", "_blank");
    });
  });

  describe("anonymous checkout", () => {
    it("should call action and redirect on success", async () => {
      const action = createMockAction();
      const onSuccess = vi.fn();
      const { result } = renderHook(() => useCheckout({ action, productId: "PROD_xxx", currency: "USD", onSuccess }));

      await act(async () => {
        result.current.checkout();
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(action).toHaveBeenCalled();
      expect(window.location.href).toBe("https://checkout.example.com/cs_123");
      expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "cs_123" }));
    });

    it("should forward orderMerchantExternalId to the server action", async () => {
      const action = createMockAction();
      const { result } = renderHook(() =>
        useCheckout({
          action,
          productId: "PROD_xxx",
          currency: "USD",
          orderMerchantExternalId: "ORDER-2026-00891",
        }),
      );

      await act(async () => {
        result.current.checkout();
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(action).toHaveBeenCalledWith(expect.objectContaining({ orderMerchantExternalId: "ORDER-2026-00891" }));
    });

    it("should forward paymentMethods to the server action", async () => {
      const action = createMockAction();
      const { result } = renderHook(() =>
        useCheckout({
          action,
          productId: "PROD_xxx",
          currency: "USD",
          paymentMethods: ["APPLEPAY", "CREDITCARD"],
        }),
      );

      await act(async () => {
        result.current.checkout();
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(action).toHaveBeenCalledWith(expect.objectContaining({ paymentMethods: ["APPLEPAY", "CREDITCARD"] }));
    });

    it("should not forward a paymentMethods key when omitted (backward compatibility)", async () => {
      const action = createMockAction();
      const { result } = renderHook(() => useCheckout({ action, productId: "PROD_xxx", currency: "USD" }));

      await act(async () => {
        result.current.checkout();
        await new Promise((r) => setTimeout(r, 10));
      });

      const calledWith = action.mock.calls[0][0];
      expect("paymentMethods" in calledWith).toBe(false);
    });
  });

  describe("authenticated checkout", () => {
    it("should call action with type=authenticated and redirect", async () => {
      const action = createMockAction({
        result: {
          sessionId: "cs_456",
          checkoutUrl: "https://checkout.example.com/cs_456#token=tok_abc",
          expiresAt: "2026-04-10T12:00:00Z",
          token: "tok_abc",
          tokenExpiresAt: "2026-04-10T12:30:00Z",
        },
      });

      const { result } = renderHook(() =>
        useCheckout({
          type: "authenticated",
          action,
          productId: "PROD_xxx",
          currency: "USD",
          buyerIdentity: "user@example.com",
        }),
      );

      await act(async () => {
        result.current.checkout();
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(action).toHaveBeenCalledWith(expect.objectContaining({ type: "authenticated", productId: "PROD_xxx" }));
      expect(window.location.href).toBe("https://checkout.example.com/cs_456#token=tok_abc");
    });
  });

  describe("popup mode", () => {
    it("should open popup and fill URL", async () => {
      const mockPopup = { location: { href: "" }, close: vi.fn() };
      vi.spyOn(window, "open").mockReturnValue(mockPopup as unknown as Window);

      const action = createMockAction();
      const { result } = renderHook(() => useCheckout({ action, productId: "PROD_xxx", currency: "USD", mode: "popup" }));

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

      const action = createMockAction({ error: new Error("API error") });
      const onError = vi.fn();

      const { result } = renderHook(() => useCheckout({ action, productId: "PROD_xxx", currency: "USD", mode: "popup", onError }));

      await act(async () => {
        result.current.checkout();
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(mockPopup.close).toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(result.current.error?.message).toBe("API error");
    });
  });

  describe("loading state", () => {
    it("should set isLoading during async checkout", async () => {
      let resolveAction: (value: unknown) => void;
      const action = vi.fn(
        () =>
          new Promise((r) => {
            resolveAction = r;
          }),
      ) as unknown as CheckoutAction;

      const { result } = renderHook(() => useCheckout({ action, productId: "PROD_xxx", currency: "USD" }));

      expect(result.current.isLoading).toBe(false);

      act(() => {
        result.current.checkout();
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveAction!({ sessionId: "cs_789", checkoutUrl: "https://checkout.example.com/cs_789", expiresAt: "2026-04-10T12:00:00Z" });
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(result.current.isLoading).toBe(false);
    });

    it("should not set isLoading for link checkout", () => {
      const { result } = renderHook(() => useCheckout({ type: "link", storeSlug: "my-store", productId: "PROD_xxx" }));

      act(() => {
        result.current.checkout();
      });

      expect(result.current.isLoading).toBe(false);
    });
  });
});
