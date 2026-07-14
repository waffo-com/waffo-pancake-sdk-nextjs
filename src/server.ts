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
 * import { createCheckoutAction, createCustomerTokenAction, createMerchantQueryAction } from "@waffo/pancake-nextjs/server";
 *
 * const config = {
 *   merchantId: process.env.WAFFO_MERCHANT_ID!,
 *   privateKey: process.env.WAFFO_PRIVATE_KEY!,
 * };
 *
 * export const checkout = createCheckoutAction(config);
 * export const issueCustomerToken = createCustomerTokenAction(config);
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
// Customer Token Action
// ============================================================

/** Server action signature for issuing customer tokens */
export type CustomerTokenAction = (params: IssueSessionTokenParams) => Promise<SessionToken>;

/**
 * Create a server action that issues customer session tokens.
 *
 * @param config - WaffoPancake client configuration
 * @returns A server action function
 *
 * @example
 * ```ts
 * "use server";
 * import { createCustomerTokenAction } from "@waffo/pancake-nextjs/server";
 *
 * export const issueCustomerToken = createCustomerTokenAction({
 *   merchantId: process.env.WAFFO_MERCHANT_ID!,
 *   privateKey: process.env.WAFFO_PRIVATE_KEY!,
 * });
 * ```
 */
export function createCustomerTokenAction(config: WaffoPancakeConfig): CustomerTokenAction {
  const client = new WaffoPancake(config);

  return async (params: IssueSessionTokenParams): Promise<SessionToken> => {
    return client.auth.issueSessionToken(params);
  };
}

// ============================================================
// Customer Session Action
// ============================================================

/** Customer action types */
export type CustomerSessionActionType =
  | "cancelSubscription"
  | "cancelOnetimeOrder"
  | "reactivateSubscription"
  | "createRefundTicket"
  | "resubmitRefundTicket"
  | "query";

/** Server action signature for customer session operations */
export type CustomerSessionAction = (token: string, actionType: CustomerSessionActionType, params: unknown) => Promise<unknown>;

/**
 * Create a server action that executes customer self-service operations.
 *
 * @param config - WaffoPancake client configuration
 * @returns A server action function
 *
 * @example
 * ```ts
 * "use server";
 * import { createCustomerSessionAction } from "@waffo/pancake-nextjs/server";
 *
 * export const customerAction = createCustomerSessionAction({
 *   merchantId: process.env.WAFFO_MERCHANT_ID!,
 *   privateKey: process.env.WAFFO_PRIVATE_KEY!,
 * });
 * ```
 */
export function createCustomerSessionAction(config: WaffoPancakeConfig): CustomerSessionAction {
  const client = new WaffoPancake(config);

  return async (token: string, actionType: CustomerSessionActionType, params: unknown): Promise<unknown> => {
    const customer = client.buyer(token);
    switch (actionType) {
      case "cancelSubscription":
        return customer.cancelSubscription(params as Parameters<typeof customer.cancelSubscription>[0]);
      case "cancelOnetimeOrder":
        return customer.cancelOnetimeOrder(params as Parameters<typeof customer.cancelOnetimeOrder>[0]);
      case "reactivateSubscription":
        return customer.reactivateSubscription(params as Parameters<typeof customer.reactivateSubscription>[0]);
      case "createRefundTicket":
        return customer.createRefundTicket(params as Parameters<typeof customer.createRefundTicket>[0]);
      case "resubmitRefundTicket":
        return customer.resubmitRefundTicket(params as Parameters<typeof customer.resubmitRefundTicket>[0]);
      case "query":
        return customer.graphql.query(params as GraphQLParams);
      default:
        throw new Error(`Unknown customer action: ${actionType}`);
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

// ============================================================
// Deprecated Aliases
// ============================================================

/** @deprecated Use {@link CustomerTokenAction} instead. */
export type BuyerTokenAction = CustomerTokenAction;

/** @deprecated Use {@link createCustomerTokenAction} instead. */
export const createBuyerTokenAction = createCustomerTokenAction;

/** @deprecated Use {@link CustomerSessionActionType} instead. */
export type BuyerSessionActionType = CustomerSessionActionType;

/** @deprecated Use {@link CustomerSessionAction} instead. */
export type BuyerSessionAction = CustomerSessionAction;

/** @deprecated Use {@link createCustomerSessionAction} instead. */
export const createBuyerSessionAction = createCustomerSessionAction;
