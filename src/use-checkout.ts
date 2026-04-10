"use client";

import { useCallback, useRef, useState } from "react";

import type { CheckoutProps, LinkCheckoutProps, UseCheckoutReturn } from "./types.js";
import type { CheckoutSessionResult, AuthenticatedCheckoutResult } from "@waffo/pancake-ts";


const LOADING_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Loading...</title><style>body{display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui,sans-serif;background:#f9fafb;color:#6b7280}@media(prefers-color-scheme:dark){body{background:#111827;color:#9ca3af}}</style></head><body><p>Redirecting to checkout...</p></body></html>`;

const DEFAULT_STOREFRONT_URL = "https://pancake.waffo.ai";

const SDK_FIELDS = new Set(["action", "type", "mode", "popupLoadingUrl", "onSuccess", "onError"]);

/** Extract API checkout params from flattened props, removing SDK-specific fields */
function extractApiParams(args: object): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!SDK_FIELDS.has(key)) params[key] = value;
  }
  return params;
}

/**
 * Build a product page URL for link checkout.
 */
function buildLinkUrl(props: LinkCheckoutProps): string {
  const base = (props.baseUrl ?? DEFAULT_STOREFRONT_URL).replace(/\/+$/, "");
  const url = new URL(`${base}/store/${props.storeSlug}/product/${props.productId}`);

  if (props.currency) url.searchParams.set("currency", props.currency);
  if (props.email) url.searchParams.set("email", props.email);
  if (props.successUrl) url.searchParams.set("success_url", props.successUrl);
  if (props.test) url.searchParams.set("test", "true");
  if (props.country) url.searchParams.set("country", props.country);
  if (props.isBusiness) url.searchParams.set("is_business", "true");

  return url.toString();
}

/**
 * React hook for triggering a Waffo Pancake checkout flow.
 *
 * Supports three checkout types:
 * - **link**: Builds a product page URL and navigates directly (no API call, synchronous)
 * - **anonymous**: Calls a server action to create a checkout session, then navigates
 * - **authenticated**: Calls a server action to create a session + token, then navigates
 *
 * The private key never leaves the server — anonymous and authenticated modes
 * use a server action created by `createCheckoutAction()`.
 *
 * @param args - Flattened checkout props
 * @returns `{ checkout, isLoading, error }`
 *
 * @example
 * ```tsx
 * // Link checkout — no server action needed
 * const { checkout } = useCheckout({
 *   type: "link",
 *   storeSlug: "my-store",
 *   productId: "PROD_xxx",
 *   currency: "USD",
 * });
 *
 * // Anonymous checkout — via server action
 * const { checkout, isLoading } = useCheckout({
 *   action: checkout, // from createCheckoutAction()
 *   productId: "PROD_xxx",
 *   currency: "USD",
 * });
 * ```
 */
export function useCheckout(args: CheckoutProps): UseCheckoutReturn {
  const { mode = "redirect", popupLoadingUrl, onError } = args;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const popupRef = useRef<Window | null>(null);

  const checkout = useCallback(() => {
    if (isLoading) return;

    // Link checkout — synchronous, no API call
    if (args.type === "link") {
      const url = buildLinkUrl(args);
      if (mode === "popup") {
        window.open(url, "_blank");
      } else {
        window.location.href = url;
      }
      return;
    }

    // Anonymous / Authenticated — server action
    if (mode === "popup") {
      const loadingUrl = popupLoadingUrl ?? `data:text/html;charset=utf-8,${encodeURIComponent(LOADING_HTML)}`;
      popupRef.current = window.open(loadingUrl, "_blank");
    }

    setIsLoading(true);
    setError(null);

    const { action } = args;
    const params = extractApiParams(args);
    const actionParams = args.type === "authenticated" ? { type: "authenticated" as const, ...params } : params;

    action(actionParams as unknown as Parameters<typeof action>[0])
      .then((result: CheckoutSessionResult | AuthenticatedCheckoutResult) => {
        if (mode === "popup" && popupRef.current) {
          popupRef.current.location.href = result.checkoutUrl;
        } else {
          window.location.href = result.checkoutUrl;
        }
        if ("onSuccess" in args && args.onSuccess) {
          (args.onSuccess as (r: CheckoutSessionResult | AuthenticatedCheckoutResult) => void)(result);
        }
      })
      .catch((err: Error) => {
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
  }, [args, mode, popupLoadingUrl, onError, isLoading]);

  return { checkout, isLoading, error };
}
