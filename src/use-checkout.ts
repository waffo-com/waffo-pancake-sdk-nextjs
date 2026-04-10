"use client";

import { useCallback, useRef, useState } from "react";

import type { WaffoPancake, AnonymousCheckoutParams, AuthenticatedCheckoutParams, CheckoutSessionResult, AuthenticatedCheckoutResult } from "@waffo/pancake-ts";

import type { CheckoutOptions, UseCheckoutReturn } from "./types.js";

const LOADING_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Loading...</title><style>body{display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui,sans-serif;background:#f9fafb;color:#6b7280}@media(prefers-color-scheme:dark){body{background:#111827;color:#9ca3af}}</style></head><body><p>Redirecting to checkout...</p></body></html>`;

/** Params for anonymous checkout */
interface AnonymousArgs {
  client: WaffoPancake;
  params: AnonymousCheckoutParams;
  type?: "anonymous";
}

/** Params for authenticated checkout */
interface AuthenticatedArgs {
  client: WaffoPancake;
  params: AuthenticatedCheckoutParams;
  type: "authenticated";
}

type CheckoutArgs = (AnonymousArgs | AuthenticatedArgs) & CheckoutOptions;

/**
 * React hook for triggering a Waffo Pancake checkout flow.
 *
 * Handles popup blocker avoidance by synchronously opening the window
 * on user click, then navigating to the checkout URL once the session
 * is created.
 *
 * @param args - Client, params, mode, and callbacks
 * @returns `{ checkout, isLoading, error }`
 *
 * @example
 * ```tsx
 * const { checkout, isLoading } = useCheckout({
 *   client,
 *   params: { productId: "PROD_xxx", currency: "USD" },
 * });
 *
 * <button onClick={checkout} disabled={isLoading}>
 *   {isLoading ? "Loading..." : "Buy Now"}
 * </button>
 * ```
 */
export function useCheckout(args: CheckoutArgs): UseCheckoutReturn {
  const { client, params, type, mode = "redirect", popupLoadingUrl, onSuccess, onError } = args;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const popupRef = useRef<Window | null>(null);

  const checkout = useCallback(() => {
    if (isLoading) return;

    // In popup mode, open the window synchronously to avoid browser blocking
    if (mode === "popup") {
      const loadingUrl = popupLoadingUrl ?? `data:text/html;charset=utf-8,${encodeURIComponent(LOADING_HTML)}`;
      popupRef.current = window.open(loadingUrl, "_blank");
    }

    setIsLoading(true);
    setError(null);

    const createSession = async (): Promise<CheckoutSessionResult | AuthenticatedCheckoutResult> => {
      if (type === "authenticated") {
        return client.checkout.authenticated.create(params as AuthenticatedCheckoutParams);
      }
      return client.checkout.anonymous.create(params as AnonymousCheckoutParams);
    };

    createSession()
      .then((result) => {
        const url = result.checkoutUrl;

        if (mode === "popup" && popupRef.current) {
          popupRef.current.location.href = url;
        } else {
          window.location.href = url;
        }

        onSuccess?.(result);
      })
      .catch((err: Error) => {
        // Close popup on error
        if (mode === "popup" && popupRef.current) {
          popupRef.current.close();
          popupRef.current = null;
        }

        setError(err);
        onError?.(err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [client, params, type, mode, popupLoadingUrl, onSuccess, onError, isLoading]);

  return { checkout, isLoading, error };
}
