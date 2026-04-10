"use client";

import React from "react";

import { useCheckout } from "./use-checkout.js";

import type { CheckoutProps, LinkCheckoutProps, AnonymousCheckoutProps, AuthenticatedCheckoutProps } from "./types.js";

type CheckoutButtonBaseProps = {
  /** Button content */
  children: React.ReactNode;
  /** Content shown while checkout session is being created */
  loadingChildren?: React.ReactNode;
  /** Additional class name */
  className?: string;
  /** Additional inline styles */
  style?: React.CSSProperties;
  /** Disabled state (merged with isLoading) */
  disabled?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "disabled" | "children">;

/** Props for CheckoutButton — link mode */
export type LinkCheckoutButtonProps = CheckoutButtonBaseProps & LinkCheckoutProps;

/** Props for CheckoutButton — anonymous mode */
export type AnonymousCheckoutButtonProps = CheckoutButtonBaseProps & AnonymousCheckoutProps;

/** Props for CheckoutButton — authenticated mode */
export type AuthenticatedCheckoutButtonProps = CheckoutButtonBaseProps & AuthenticatedCheckoutProps;

export type CheckoutButtonProps = LinkCheckoutButtonProps | AnonymousCheckoutButtonProps | AuthenticatedCheckoutButtonProps;

/**
 * A button that triggers a Waffo Pancake checkout flow on click.
 *
 * Three checkout types:
 * - **link**: Instant redirect to product page URL (no server action needed)
 * - **anonymous**: Calls server action to create session, then redirects
 * - **authenticated**: Calls server action to create session + token, then redirects
 *
 * The private key never leaves the server — anonymous and authenticated modes
 * use a server action created by `createCheckoutAction()`.
 *
 * @param props - Flattened checkout props, button content, and optional styling
 *
 * @example
 * ```tsx
 * // Link checkout — no server action needed
 * <CheckoutButton type="link" storeSlug="my-store" productId="PROD_xxx" currency="USD">
 *   Buy Now
 * </CheckoutButton>
 *
 * // Anonymous checkout — via server action
 * <CheckoutButton action={checkout} productId="PROD_xxx" currency="USD">
 *   Buy Now
 * </CheckoutButton>
 *
 * // Authenticated checkout — via server action
 * <CheckoutButton action={checkout} type="authenticated" productId="PROD_xxx" currency="USD" buyerIdentity="user@example.com">
 *   Buy Now
 * </CheckoutButton>
 * ```
 */
export function CheckoutButton(props: CheckoutButtonProps) {
  const { children, loadingChildren, className, style, disabled, ...checkoutProps } = props;

  const { checkout, isLoading } = useCheckout(checkoutProps as CheckoutProps);

  return (
    <button type="button" onClick={checkout} disabled={disabled || isLoading} className={className} style={style}>
      {isLoading ? (loadingChildren ?? children) : children}
    </button>
  );
}
