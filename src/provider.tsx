"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { CustomerTokenAction, CustomerSessionAction } from "./server.js";

/** Customer configuration for automatic token management */
export interface CustomerConfig {
  /** Customer identity (email or merchant-provided identifier) */
  identity: string;
  /** Store ID (optional when `productId` is provided) */
  storeId?: string;
  /** Product ID — used to derive the store when `storeId` is omitted */
  productId?: string;
  /** Server action for issuing tokens — from `createCustomerTokenAction()` */
  issueToken: CustomerTokenAction;
  /** Server action for customer operations — from `createCustomerSessionAction()` */
  sessionAction: CustomerSessionAction;
}

/** @deprecated Use {@link CustomerConfig} instead. */
export type BuyerConfig = CustomerConfig;

interface TokenState {
  token: string;
  expiresAt: number;
}

/** @internal */
export interface PancakeContextValue {
  /** Get a valid customer token (auto-refreshes if expired) */
  getCustomerToken: () => Promise<string>;
  /** Execute a customer session operation via server action */
  customerSessionAction: CustomerSessionAction;
  /** Whether customer config is provided */
  hasCustomer: boolean;
  /** Whether the initial token is ready */
  isCustomerReady: boolean;
}

/** @internal Exported for direct useContext access in hooks */
export const PancakeContext = createContext<PancakeContextValue | null>(null);

/** Token refresh buffer — refresh 30s before actual expiry */
const REFRESH_BUFFER_MS = 30_000;

export interface WaffoPancakeProviderProps {
  /** Customer configuration for automatic token management */
  customer?: CustomerConfig;
  /** @deprecated Use `customer` instead. */
  buyer?: CustomerConfig;
  children: React.ReactNode;
}

/**
 * Provider that manages customer token lifecycle via server actions.
 *
 * Auto-issues session tokens on mount and refreshes before expiry.
 * All customer hooks (`useCustomer`, `useCustomerOrders`, etc.) read from context.
 *
 * The private key never leaves the server — token issuance and customer
 * operations are delegated to server actions.
 *
 * @param props - Provider configuration
 * @param props.customer - Customer identity and server actions
 * @param props.buyer - Deprecated alias of `customer`
 * @param props.children - React children
 *
 * @example
 * ```tsx
 * // identity must match what you passed as `buyerIdentity` at checkout time —
 * // customer-portal lookups are keyed by merchant_provided_buyer_identity
 * <WaffoPancakeProvider customer={{
 *   identity: user.id,
 *   storeId: "STO_xxx",
 *   issueToken,       // from createCustomerTokenAction()
 *   sessionAction,    // from createCustomerSessionAction()
 * }}>
 *   <App />
 * </WaffoPancakeProvider>
 * ```
 */
export function WaffoPancakeProvider({ customer, buyer, children }: WaffoPancakeProviderProps) {
  const config = customer ?? buyer;
  if (!config) throw new Error("WaffoPancakeProvider: the `customer` prop is required");

  const tokenRef = useRef<TokenState | null>(null);
  const refreshPromiseRef = useRef<Promise<string> | null>(null);
  const [isCustomerReady, setIsCustomerReady] = useState(false);

  const refreshToken = useCallback(async (): Promise<string> => {
    const result = await config.issueToken({
      buyerIdentity: config.identity,
      storeId: config.storeId,
      productId: config.productId,
    });

    tokenRef.current = {
      token: result.token,
      expiresAt: new Date(result.expiresAt).getTime(),
    };

    return result.token;
  }, [config]);

  const getCustomerToken = useCallback(async (): Promise<string> => {
    const current = tokenRef.current;
    if (current && Date.now() < current.expiresAt - REFRESH_BUFFER_MS) {
      return current.token;
    }

    // Deduplicate concurrent refresh calls
    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = refreshToken().finally(() => {
        refreshPromiseRef.current = null;
      });
    }

    return refreshPromiseRef.current;
  }, [refreshToken]);

  // Issue initial token on mount
  useEffect(() => {
    refreshToken()
      .then(() => setIsCustomerReady(true))
      .catch(() => setIsCustomerReady(true));
  }, [refreshToken]);

  const value = useMemo<PancakeContextValue>(
    () => ({
      getCustomerToken,
      customerSessionAction: config.sessionAction,
      hasCustomer: true,
      isCustomerReady,
    }),
    [getCustomerToken, config.sessionAction, isCustomerReady],
  );

  return <PancakeContext.Provider value={value}>{children}</PancakeContext.Provider>;
}

/**
 * Access the Waffo Pancake context. Must be used within `<WaffoPancakeProvider>`.
 */
export function usePancakeContext(): PancakeContextValue {
  const ctx = useContext(PancakeContext);
  if (!ctx) throw new Error("usePancakeContext: must be used within <WaffoPancakeProvider>");
  return ctx;
}
