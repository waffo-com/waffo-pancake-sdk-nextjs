"use client";

import React from "react";

import { useCheckout } from "./use-checkout.js";

import type { AnonymousCheckoutProps, AuthenticatedCheckoutProps } from "./types.js";

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

/** Props for CheckoutButton — anonymous mode */
export type AnonymousCheckoutButtonProps = CheckoutButtonBaseProps & AnonymousCheckoutProps;

/** Props for CheckoutButton — authenticated mode */
export type AuthenticatedCheckoutButtonProps = CheckoutButtonBaseProps &
  AuthenticatedCheckoutProps & {
    type: "authenticated";
  };

export type CheckoutButtonProps = AnonymousCheckoutButtonProps | AuthenticatedCheckoutButtonProps;

/**
 * A button that triggers a Waffo Pancake checkout flow on click.
 *
 * Avoids popup blockers by opening the window synchronously in the click handler.
 * Shows a loading state while the checkout session is being created.
 *
 * @example
 * ```tsx
 * // Anonymous checkout — redirect (default)
 * <CheckoutButton
 *   client={client}
 *   params={{ productId: "PROD_xxx", currency: "USD" }}
 * >
 *   Buy Now
 * </CheckoutButton>
 *
 * // Authenticated checkout — popup
 * <CheckoutButton
 *   client={client}
 *   params={{ productId: "PROD_xxx", currency: "USD", buyerIdentity: "user@example.com" }}
 *   type="authenticated"
 *   mode="popup"
 *   loadingChildren="Opening checkout..."
 * >
 *   Buy Now
 * </CheckoutButton>
 * ```
 */
export function CheckoutButton(props: CheckoutButtonProps) {
  const {
    client,
    params,
    mode,
    popupLoadingUrl,
    onSuccess,
    onError,
    children,
    loadingChildren,
    className,
    style,
    disabled,
    ...buttonProps
  } = props;

  const type = "type" in props ? props.type : undefined;

  const { checkout, isLoading } = useCheckout({
    client,
    params: params as never,
    type: type as never,
    mode,
    popupLoadingUrl,
    onSuccess,
    onError,
  });

  return (
    <button type="button" onClick={checkout} disabled={disabled || isLoading} className={className} style={style} {...buttonProps}>
      {isLoading ? (loadingChildren ?? children) : children}
    </button>
  );
}
