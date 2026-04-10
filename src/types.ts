import type { WaffoPancake, AnonymousCheckoutParams, AuthenticatedCheckoutParams, CheckoutSessionResult, AuthenticatedCheckoutResult } from "@waffo/pancake-ts";

/** Redirect mode for checkout navigation */
export type CheckoutMode = "redirect" | "popup";

/** Base checkout options shared by hook and component */
export interface CheckoutOptions {
  /** How to navigate to checkout page. Default: `"redirect"` */
  mode?: CheckoutMode;
  /**
   * Loading page URL shown in popup while checkout session is being created.
   * Only used when `mode` is `"popup"`. Defaults to a minimal inline loading page.
   */
  popupLoadingUrl?: string;
  /** Callback fired when checkout session is successfully created */
  onSuccess?: (result: CheckoutSessionResult | AuthenticatedCheckoutResult) => void;
  /** Callback fired when checkout session creation fails */
  onError?: (error: Error) => void;
}

/** Props for anonymous checkout */
export interface AnonymousCheckoutProps extends CheckoutOptions {
  /** Waffo Pancake client instance */
  client: WaffoPancake;
  /** Checkout parameters */
  params: AnonymousCheckoutParams;
}

/** Props for authenticated checkout */
export interface AuthenticatedCheckoutProps extends CheckoutOptions {
  /** Waffo Pancake client instance */
  client: WaffoPancake;
  /** Checkout parameters */
  params: AuthenticatedCheckoutParams;
}

/** Return type of useCheckout hook */
export interface UseCheckoutReturn {
  /** Trigger the checkout flow */
  checkout: () => void;
  /** Whether a checkout session is being created */
  isLoading: boolean;
  /** Error from the last checkout attempt, if any */
  error: Error | null;
}
