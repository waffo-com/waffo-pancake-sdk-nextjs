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
   * Promotion code to apply on the product page (sent as `discount_code`).
   * The code is applied and locked: the customer sees the discount but no code entry field,
   * and cannot change or remove it. If the code cannot be used, the checkout page says why.
   * Works for one-time and subscription products. On a subscription the coupon's duration
   * decides how many billing periods are discounted; a free trial uses no discount, and it
   * starts with the first paid period. A product link never starts a plan change; for how
   * discounts behave on one, see https://docs.waffo.ai/guides/discounts#plan-changes.
   */
  discountCode?: string;
  /**
   * Base URL of the storefront. Default: `"https://pancake.waffo.ai"`
   */
  baseUrl?: string;
}

/**
 * Anonymous checkout — creates session via server action.
 *
 * `couponId` and `promotionCode` are not accepted: the server action strips them, because anything
 * the browser sends would be applied with your API Key. Set `allowPromotionCodes` to let the customer
 * enter a code, or apply a coupon or promotion code from your own server code with `@waffo/pancake-ts`.
 */
export type AnonymousCheckoutProps = CheckoutBaseOptions & {
  type?: "anonymous";
  /** Server action created by `createCheckoutAction()` */
  action: CheckoutAction;
  /** Callback fired when checkout session is successfully created */
  onSuccess?: (result: CheckoutSessionResult) => void;
} & Omit<AnonymousCheckoutParams, "couponId" | "promotionCode">;

/**
 * Authenticated checkout — creates session + token via server action.
 *
 * `couponId` and `promotionCode` are not accepted, for the same reason as on {@link AnonymousCheckoutProps}.
 */
export type AuthenticatedCheckoutProps = CheckoutBaseOptions & {
  type: "authenticated";
  /** Server action created by `createCheckoutAction()` */
  action: CheckoutAction;
  /** Callback fired when checkout session is successfully created */
  onSuccess?: (result: AuthenticatedCheckoutResult) => void;
} & Omit<AuthenticatedCheckoutParams, "couponId" | "promotionCode">;

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
