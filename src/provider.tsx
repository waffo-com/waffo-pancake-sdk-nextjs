"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { BuyerTokenAction, BuyerSessionAction } from "./server.js";

/** Buyer configuration for automatic token management */
export interface BuyerConfig {
  /** Buyer identity (email or merchant-provided identifier) */
  identity: string;
  /** Store ID (optional when `productId` is provided) */
  storeId?: string;
  /** Product ID — used to derive the store when `storeId` is omitted */
  productId?: string;
  /** Server action for issuing tokens — from `createBuyerTokenAction()` */
  issueToken: BuyerTokenAction;
  /** Server action for buyer operations — from `createBuyerSessionAction()` */
  sessionAction: BuyerSessionAction;
}

interface TokenState {
  token: string;
  expiresAt: number;
}

/** @internal */
export interface PancakeContextValue {
  /** Get a valid buyer token (auto-refreshes if expired) */
  getBuyerToken: () => Promise<string>;
  /** Execute a buyer session operation via server action */
  buyerSessionAction: BuyerSessionAction;
  /** Whether buyer config is provided */
  hasBuyer: boolean;
  /** Whether the initial token is ready */
  isBuyerReady: boolean;
}

/** @internal Exported for direct useContext access in hooks */
export const PancakeContext = createContext<PancakeContextValue | null>(null);

/** Token refresh buffer — refresh 30s before actual expiry */
const REFRESH_BUFFER_MS = 30_000;

export interface WaffoPancakeProviderProps {
  /** Buyer configuration for automatic token management */
  buyer: BuyerConfig;
  children: React.ReactNode;
}

/**
 * Provider that manages buyer token lifecycle via server actions.
 *
 * Auto-issues session tokens on mount and refreshes before expiry.
 * All buyer hooks (`useBuyer`, `useBuyerOrders`, etc.) read from context.
 *
 * The private key never leaves the server — token issuance and buyer
 * operations are delegated to server actions.
 *
 * @param props - Provider configuration
 * @param props.buyer - Buyer identity and server actions
 * @param props.children - React children
 *
 * @example
 * ```tsx
 * <WaffoPancakeProvider buyer={{
 *   identity: user.email,
 *   storeId: "STO_xxx",
 *   issueToken,       // from createBuyerTokenAction()
 *   sessionAction,    // from createBuyerSessionAction()
 * }}>
 *   <App />
 * </WaffoPancakeProvider>
 * ```
 */
export function WaffoPancakeProvider({ buyer, children }: WaffoPancakeProviderProps) {
  const tokenRef = useRef<TokenState | null>(null);
  const refreshPromiseRef = useRef<Promise<string> | null>(null);
  const [isBuyerReady, setIsBuyerReady] = useState(false);

  const refreshToken = useCallback(async (): Promise<string> => {
    const result = await buyer.issueToken({
      buyerIdentity: buyer.identity,
      storeId: buyer.storeId,
      productId: buyer.productId,
    });

    tokenRef.current = {
      token: result.token,
      expiresAt: new Date(result.expiresAt).getTime(),
    };

    return result.token;
  }, [buyer]);

  const getBuyerToken = useCallback(async (): Promise<string> => {
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
      .then(() => setIsBuyerReady(true))
      .catch(() => setIsBuyerReady(true));
  }, [refreshToken]);

  const value = useMemo<PancakeContextValue>(
    () => ({
      getBuyerToken,
      buyerSessionAction: buyer.sessionAction,
      hasBuyer: true,
      isBuyerReady,
    }),
    [getBuyerToken, buyer.sessionAction, isBuyerReady],
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
