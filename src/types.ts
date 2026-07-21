import type { CheckoutAction } from "./server.js";
import type {
  AnonymousCheckoutParams,
  AuthenticatedCheckoutParams,
  CheckoutSessionResult,
  AuthenticatedCheckoutResult,
} from "@waffo/pancake-ts";

/** Redirect mode for checkout navigation */
export type CheckoutMode = "redirect" | "popup";

/** Base checkout options shared by all checkout types */
export interface CheckoutBaseOptions {
  /** How to navigate to checkout page. Default: `"redirect"` */
  mode?: CheckoutMode;
  /**
   * Loading page URL shown in popup while checkout session is being created.
   * Only used when `mode` is `"popup"`. Defaults to a minimal inline loading page.
   */
  popupLoadingUrl?: string;
  /** Callback fired on error */
  onError?: (error: Error) => void;
}

/** Link checkout — redirects to product page URL, no API call needed */
export interface LinkCheckoutProps extends CheckoutBaseOptions {
  type: "link";
  /** Store slug (from Dashboard) */
  storeSlug: string;
  /** Product ID */
  productId: string;
  /** Currency code (ISO 4217). If omitted, product page auto-detects. */
  currency?: string;
  /** Pre-fill customer email */
  email?: string;
  /** Redirect URL after successful payment */
  successUrl?: string;
  /** Use test environment */
  test?: boolean;
  /** Pre-fill billing country (ISO 3166-1) */
  country?: string;
  /** Is business purchase */
  isBusiness?: boolean;
  /**
   * Optional ordered allowlist of payment methods to show on the hosted checkout page
   * (e.g. `["APPLEPAY", "CREDITCARD"]`). Encoded as a comma-separated `payment_methods`
   * query param, preserving order. Omit to preserve the current default behavior.
   */
  paymentMethods?: string[];
  /**
   * Base URL of the storefront. Default: `"https://pancake.waffo.ai"`
   */
  baseUrl?: string;
}

/** Anonymous checkout — creates session via server action */
export type AnonymousCheckoutProps = CheckoutBaseOptions & {
  type?: "anonymous";
  /** Server action created by `createCheckoutAction()` */
  action: CheckoutAction;
  /** Callback fired when checkout session is successfully created */
  onSuccess?: (result: CheckoutSessionResult) => void;
} & AnonymousCheckoutParams;

/** Authenticated checkout — creates session + token via server action */
export type AuthenticatedCheckoutProps = CheckoutBaseOptions & {
  type: "authenticated";
  /** Server action created by `createCheckoutAction()` */
  action: CheckoutAction;
  /** Callback fired when checkout session is successfully created */
  onSuccess?: (result: AuthenticatedCheckoutResult) => void;
} & AuthenticatedCheckoutParams;

/** Union of all checkout prop types */
export type CheckoutProps = LinkCheckoutProps | AnonymousCheckoutProps | AuthenticatedCheckoutProps;

/** Return type of useCheckout hook */
export interface UseCheckoutReturn {
  /** Trigger the checkout flow */
  checkout: () => void;
  /** Whether a checkout session is being created */
  isLoading: boolean;
  /** Error from the last checkout attempt, if any */
  error: Error | null;
}
