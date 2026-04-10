/**
 * Server-side entry point for @waffo/pancake-nextjs.
 *
 * All functions in this module use the private key for RSA signing
 * and must only run on the server (Next.js Server Actions / Route Handlers).
 *
 * @example
 * ```ts
 * // app/lib/waffo.ts
 * "use server";
 * import { createCheckoutAction, createBuyerTokenAction, createMerchantQueryAction } from "@waffo/pancake-nextjs/server";
 *
 * const config = {
 *   merchantId: process.env.WAFFO_MERCHANT_ID!,
 *   privateKey: process.env.WAFFO_PRIVATE_KEY!,
 * };
 *
 * export const checkout = createCheckoutAction(config);
 * export const issueBuyerToken = createBuyerTokenAction(config);
 * export const merchantQuery = createMerchantQueryAction(config);
 * ```
 */
import { WaffoPancake } from "@waffo/pancake-ts";

import type {
  WaffoPancakeConfig,
  AnonymousCheckoutParams,
  AuthenticatedCheckoutParams,
  CheckoutSessionResult,
  AuthenticatedCheckoutResult,
  IssueSessionTokenParams,
  SessionToken,
  GraphQLParams,
  GraphQLResponse,
} from "@waffo/pancake-ts";

// ============================================================
// Checkout Action
// ============================================================

/** Parameters for the checkout server action */
export type CheckoutActionParams =
  | ({ type?: "anonymous" } & AnonymousCheckoutParams)
  | ({ type: "authenticated" } & AuthenticatedCheckoutParams);

/** Result of the checkout server action */
export type CheckoutActionResult = CheckoutSessionResult | AuthenticatedCheckoutResult;

/** Server action signature for checkout */
export type CheckoutAction = (params: CheckoutActionParams) => Promise<CheckoutActionResult>;

/**
 * Create a server action that handles checkout session creation.
 *
 * The private key is captured in the closure and never sent to the client.
 *
 * @param config - WaffoPancake client configuration (merchantId + privateKey)
 * @returns A server action function
 *
 * @example
 * ```ts
 * "use server";
 * import { createCheckoutAction } from "@waffo/pancake-nextjs/server";
 *
 * export const checkout = createCheckoutAction({
 *   merchantId: process.env.WAFFO_MERCHANT_ID!,
 *   privateKey: process.env.WAFFO_PRIVATE_KEY!,
 * });
 * ```
 */
export function createCheckoutAction(config: WaffoPancakeConfig): CheckoutAction {
  const client = new WaffoPancake(config);

  return async (params: CheckoutActionParams): Promise<CheckoutActionResult> => {
    if (params.type === "authenticated") {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- remove type field before passing to SDK
      const { type, ...sdkParams } = params;
      return client.checkout.authenticated.create(sdkParams);
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- remove type field before passing to SDK
    const { type, ...sdkParams } = params;
    return client.checkout.anonymous.create(sdkParams);
  };
}

// ============================================================
// Buyer Token Action
// ============================================================

/** Server action signature for issuing buyer tokens */
export type BuyerTokenAction = (params: IssueSessionTokenParams) => Promise<SessionToken>;

/**
 * Create a server action that issues buyer session tokens.
 *
 * @param config - WaffoPancake client configuration
 * @returns A server action function
 *
 * @example
 * ```ts
 * "use server";
 * import { createBuyerTokenAction } from "@waffo/pancake-nextjs/server";
 *
 * export const issueBuyerToken = createBuyerTokenAction({
 *   merchantId: process.env.WAFFO_MERCHANT_ID!,
 *   privateKey: process.env.WAFFO_PRIVATE_KEY!,
 * });
 * ```
 */
export function createBuyerTokenAction(config: WaffoPancakeConfig): BuyerTokenAction {
  const client = new WaffoPancake(config);

  return async (params: IssueSessionTokenParams): Promise<SessionToken> => {
    return client.auth.issueSessionToken(params);
  };
}

// ============================================================
// Buyer Session Action
// ============================================================

/** Buyer action types */
export type BuyerSessionActionType =
  | "cancelSubscription"
  | "cancelOnetimeOrder"
  | "reactivateSubscription"
  | "createRefundTicket"
  | "resubmitRefundTicket"
  | "query";

/** Server action signature for buyer session operations */
export type BuyerSessionAction = (token: string, actionType: BuyerSessionActionType, params: unknown) => Promise<unknown>;

/**
 * Create a server action that executes buyer self-service operations.
 *
 * @param config - WaffoPancake client configuration
 * @returns A server action function
 *
 * @example
 * ```ts
 * "use server";
 * import { createBuyerSessionAction } from "@waffo/pancake-nextjs/server";
 *
 * export const buyerAction = createBuyerSessionAction({
 *   merchantId: process.env.WAFFO_MERCHANT_ID!,
 *   privateKey: process.env.WAFFO_PRIVATE_KEY!,
 * });
 * ```
 */
export function createBuyerSessionAction(config: WaffoPancakeConfig): BuyerSessionAction {
  const client = new WaffoPancake(config);

  return async (token: string, actionType: BuyerSessionActionType, params: unknown): Promise<unknown> => {
    const buyer = client.buyer(token);
    switch (actionType) {
      case "cancelSubscription":
        return buyer.cancelSubscription(params as Parameters<typeof buyer.cancelSubscription>[0]);
      case "cancelOnetimeOrder":
        return buyer.cancelOnetimeOrder(params as Parameters<typeof buyer.cancelOnetimeOrder>[0]);
      case "reactivateSubscription":
        return buyer.reactivateSubscription(params as Parameters<typeof buyer.reactivateSubscription>[0]);
      case "createRefundTicket":
        return buyer.createRefundTicket(params as Parameters<typeof buyer.createRefundTicket>[0]);
      case "resubmitRefundTicket":
        return buyer.resubmitRefundTicket(params as Parameters<typeof buyer.resubmitRefundTicket>[0]);
      case "query":
        return buyer.graphql.query(params as GraphQLParams);
      default:
        throw new Error(`Unknown buyer action: ${actionType}`);
    }
  };
}

// ============================================================
// Merchant Query Action
// ============================================================

/** Server action signature for merchant GraphQL queries */
export type MerchantQueryAction = (params: GraphQLParams) => Promise<GraphQLResponse>;

/**
 * Create a server action that executes merchant GraphQL queries.
 *
 * @param config - WaffoPancake client configuration
 * @returns A server action function
 *
 * @example
 * ```ts
 * "use server";
 * import { createMerchantQueryAction } from "@waffo/pancake-nextjs/server";
 *
 * export const merchantQuery = createMerchantQueryAction({
 *   merchantId: process.env.WAFFO_MERCHANT_ID!,
 *   privateKey: process.env.WAFFO_PRIVATE_KEY!,
 * });
 * ```
 */
export function createMerchantQueryAction(config: WaffoPancakeConfig): MerchantQueryAction {
  const client = new WaffoPancake(config);

  return async (params: GraphQLParams): Promise<GraphQLResponse> => {
    return client.graphql.query(params);
  };
}
