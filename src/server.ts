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
  RequestOptions,
  WaffoPancakeConfig,
  AnonymousCheckoutParams,
  AuthenticatedCheckoutParams,
  AuthenticatedPlanChangeParams,
  CreatePlanChangeSessionParams,
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

/**
 * Parameters for the checkout server action.
 *
 * The `type` field selects the flow: a new purchase (`anonymous` / `authenticated`)
 * or a plan change for an existing subscription (`planChange` /
 * `authenticatedPlanChange`, which carry the required `originOrderId`).
 */
export type CheckoutActionParams =
  | ({ type?: "anonymous" } & AnonymousCheckoutParams)
  | ({ type: "authenticated" } & AuthenticatedCheckoutParams)
  | ({ type: "planChange" } & CreatePlanChangeSessionParams)
  | ({ type: "authenticatedPlanChange" } & AuthenticatedPlanChangeParams);

/** Result of the checkout server action */
export type CheckoutActionResult = CheckoutSessionResult | AuthenticatedCheckoutResult;

/**
 * Server action signature for checkout.
 *
 * The optional `options` carries an `idempotencyKey`; without one no key is sent
 * and a retried call creates a second session.
 */
export type CheckoutAction = (params: CheckoutActionParams, options?: RequestOptions) => Promise<CheckoutActionResult>;

/**
 * Create a server action that handles checkout session creation.
 *
 * The private key is captured in the closure and never sent to the client.
 *
 * Handles both new purchases and plan changes; `params.type` selects the flow.
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
 *
 * @example
 * ```ts
 * // Plan change link for an existing subscription — originOrderId is required
 * const session = await checkout({
 *   type: "planChange",
 *   originOrderId: "ORD_xxx",
 *   productId: "PROD_target_plan",
 *   currency: "USD",
 * });
 * // session.checkoutUrl points at the change confirmation page
 * ```
 */
export function createCheckoutAction(config: WaffoPancakeConfig): CheckoutAction {
  const client = new WaffoPancake(config);

  return async (params: CheckoutActionParams, options?: RequestOptions): Promise<CheckoutActionResult> => {
    if (params.type === "authenticated") {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- remove type field before passing to SDK
      const { type, ...sdkParams } = params;
      return client.checkout.authenticated.create(sdkParams, options);
    }
    if (params.type === "planChange") {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- remove type field before passing to SDK
      const { type, ...sdkParams } = params;
      return client.checkout.createPlanChangeSession(sdkParams, options);
    }
    if (params.type === "authenticatedPlanChange") {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- remove type field before passing to SDK
      const { type, ...sdkParams } = params;
      return client.checkout.authenticated.createPlanChange(sdkParams, options);
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- remove type field before passing to SDK
    const { type, ...sdkParams } = params;
    return client.checkout.anonymous.create(sdkParams, options);
  };
}

// ============================================================
// Customer Token Action
// ============================================================

/** Server action signature for issuing customer tokens */
export type CustomerTokenAction = (params: IssueSessionTokenParams, options?: RequestOptions) => Promise<SessionToken>;

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

  return async (params: IssueSessionTokenParams, options?: RequestOptions): Promise<SessionToken> => {
    return client.auth.issueSessionToken(params, options);
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
  | "createPlanChangeSession"
  | "query";

/** Server action signature for customer session operations */
export type CustomerSessionAction = (
  token: string,
  actionType: CustomerSessionActionType,
  params: unknown,
  options?: RequestOptions,
) => Promise<unknown>;

/**
 * Create a server action that executes customer self-service operations.
 *
 * `config.environment` is required — session tokens carry no environment, and the
 * gateway rejects a session request without the matching header.
 *
 * `createPlanChangeSession` is the customer-driven half of a plan change: it returns
 * a confirmation-page URL, and the platform allows it only when the subscription
 * belongs to that customer, the target plan is in the same product group, and that
 * group's `selfServicePlanChange` is on — otherwise 403. The merchant-only pricing
 * fields are not part of its params; the platform drops them on this path silently.
 *
 * No call sends an idempotency key unless you pass one (`options.idempotencyKey`,
 * the last argument) — the same rule as every other method in the SDK — so a write
 * retried after a timeout executes twice.
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
 *   environment: "test",
 * });
 * ```
 */
export function createCustomerSessionAction(config: WaffoPancakeConfig): CustomerSessionAction {
  const client = new WaffoPancake(config);

  return async (token: string, actionType: CustomerSessionActionType, params: unknown, options?: RequestOptions): Promise<unknown> => {
    const customer = client.buyer(token);
    switch (actionType) {
      case "cancelSubscription":
        return customer.cancelSubscription(params as Parameters<typeof customer.cancelSubscription>[0], options);
      case "cancelOnetimeOrder":
        return customer.cancelOnetimeOrder(params as Parameters<typeof customer.cancelOnetimeOrder>[0], options);
      case "reactivateSubscription":
        return customer.reactivateSubscription(params as Parameters<typeof customer.reactivateSubscription>[0], options);
      case "createRefundTicket":
        return customer.createRefundTicket(params as Parameters<typeof customer.createRefundTicket>[0], options);
      case "resubmitRefundTicket":
        return customer.resubmitRefundTicket(params as Parameters<typeof customer.resubmitRefundTicket>[0], options);
      case "createPlanChangeSession":
        return customer.createPlanChangeSession(params as Parameters<typeof customer.createPlanChangeSession>[0], options);
      case "query":
        // Reads take no key: a cached replay would serve stale data.
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
