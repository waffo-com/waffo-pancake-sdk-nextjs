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
 *
 * @example
 * ```ts
 * // app/account/billing-portal/route.ts — customer portal entry from your own login
 * import { createCustomerPortalRedirect } from "@waffo/pancake-nextjs/server";
 *
 * export const GET = createCustomerPortalRedirect(config, {
 *   resolveAuthenticatedCustomer: async (request) => getSignedInCustomer(request), // your session
 * });
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
 * Checkout fields only the merchant may set: the server action signs with the API Key, so
 * whatever it forwards is applied as the merchant's own choice — a coupon or prefilled
 * promotion code (`couponId`, `promotionCode`), a custom price (`priceSnapshot`), the trial
 * decision (`withTrial`) and the plan change amount (`changeAmount`, `changeCreditAmount`).
 * The checkout server action never accepts them from the browser.
 */
export type MerchantOnlyCheckoutField =
  | "couponId"
  | "promotionCode"
  | "priceSnapshot"
  | "withTrial"
  | "changeAmount"
  | "changeCreditAmount";

/**
 * `T` without the {@link MerchantOnlyCheckoutField} fields, each re-declared as `never` so that
 * passing one is a compile error rather than a silently dropped value.
 *
 * @example
 * ```ts
 * type Params = WithoutMerchantOnlyFields<AnonymousCheckoutParams>;
 * const ok: Params = { productId: "PROD_xxx", currency: "USD", allowPromotionCodes: true };
 * // @ts-expect-error — priceSnapshot is merchant-only
 * const bad: Params = { productId: "PROD_xxx", currency: "USD", priceSnapshot: { amount: "1.00", taxCategory: "saas" } };
 * ```
 */
export type WithoutMerchantOnlyFields<T> = Omit<T, MerchantOnlyCheckoutField> & {
  [K in MerchantOnlyCheckoutField]?: never;
};

/**
 * Parameters for the checkout server action.
 *
 * The `type` field selects the flow: a new purchase (`anonymous` / `authenticated`)
 * or a plan change for an existing subscription (`planChange` /
 * `authenticatedPlanChange`, which carry the required `originOrderId`).
 *
 * The {@link MerchantOnlyCheckoutField} fields (`couponId`, `promotionCode`, `priceSnapshot`,
 * `withTrial`, `changeAmount`, `changeCreditAmount`) are typed `never` on every shape and
 * stripped at runtime — see {@link createCheckoutAction}.
 */
export type CheckoutActionParams =
  | ({ type?: "anonymous" } & WithoutMerchantOnlyFields<AnonymousCheckoutParams>)
  | ({ type: "authenticated" } & WithoutMerchantOnlyFields<AuthenticatedCheckoutParams>)
  | ({ type: "planChange" } & WithoutMerchantOnlyFields<CreatePlanChangeSessionParams>)
  | ({ type: "authenticatedPlanChange" } & WithoutMerchantOnlyFields<AuthenticatedPlanChangeParams>);

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
 * Remove every {@link MerchantOnlyCheckoutField} from parameters that arrived from the browser.
 *
 * Behavior:
 * - Drops `couponId`, `promotionCode`, `priceSnapshot`, `withTrial`, `changeAmount` and
 *   `changeCreditAmount`; every other field (`allowPromotionCodes` included) is kept.
 *
 * Side effects:
 * - None: returns a shallow copy, the input is not modified.
 *
 * Edge cases:
 * - Applied on every flow, new purchase and plan change alike. A Server Action is callable
 *   with arbitrary arguments and this one signs with the merchant API Key, so a forwarded
 *   field would be honored as the merchant's choice: any coupon of the store, a prefilled
 *   code, a price of the customer's choosing, a skipped trial check, or a plan change
 *   charge or credit the customer picked.
 *
 * @param params - Parameters as received by the server action
 * @returns The parameters without the merchant-only fields
 *
 * @example
 * ```ts
 * stripMerchantOnlyFields({ productId: "PROD_xxx", currency: "USD", priceSnapshot: { amount: "0.01", taxCategory: "saas" } });
 * // => { productId: "PROD_xxx", currency: "USD" }
 * ```
 */
function stripMerchantOnlyFields<T extends object>(params: T): Omit<T, MerchantOnlyCheckoutField> {
  const {
    /* eslint-disable @typescript-eslint/no-unused-vars -- drop the browser-supplied merchant-only fields */
    couponId,
    promotionCode,
    priceSnapshot,
    withTrial,
    changeAmount,
    changeCreditAmount,
    /* eslint-enable @typescript-eslint/no-unused-vars */
    ...rest
  } = params as T & Partial<Record<MerchantOnlyCheckoutField, unknown>>;
  return rest;
}

/**
 * Create a server action that handles checkout session creation.
 *
 * The private key is captured in the closure and never sent to the client.
 *
 * Handles both new purchases and plan changes; `params.type` selects the flow.
 *
 * `couponId`, `promotionCode`, `priceSnapshot`, `withTrial`, `changeAmount` and
 * `changeCreditAmount` are always stripped before the request is sent, on new purchases
 * and plan changes: a Server Action is callable from the browser with any arguments, and
 * whatever is sent with your API Key is applied as your choice. To set any of them, call
 * `@waffo/pancake-ts` (`client.checkout.authenticated.create({ ..., couponId })`,
 * `client.checkout.anonymous.create({ ..., priceSnapshot })`,
 * `client.checkout.createPlanChangeSession({ ..., changeCreditAmount })`, …) from your own
 * server code after deciding the customer is entitled to it. `allowPromotionCodes` is
 * forwarded — it only shows the code entry field, and every code is checked by the platform.
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

  return async (rawParams: CheckoutActionParams, options?: RequestOptions): Promise<CheckoutActionResult> => {
    const params = stripMerchantOnlyFields(rawParams) as CheckoutActionParams;
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
 * This is a generic token primitive: it signs whatever `buyerIdentity` it is
 * handed. Never expose it to the browser as a portal or sign-in entry — a
 * Server Action is callable with arbitrary arguments, so a client-chosen
 * `buyerIdentity` would yield another customer's token. To send a signed-in
 * customer to the customer portal, use {@link createCustomerPortalRedirect},
 * which derives identity from your own session.
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
// Customer Portal Redirect
// ============================================================

/**
 * Store and customer identity for a customer portal link, resolved by the
 * merchant app from its own authenticated session.
 */
export interface AuthenticatedPortalCustomer {
  /** Store ID (Short ID `STO_xxx`) whose portal the customer enters */
  storeId: string;
  /** Customer identity in your system — the same value used for authenticated checkout */
  buyerIdentity: string;
}

/** Options for {@link createCustomerPortalRedirect}. */
export interface CustomerPortalRedirectOptions {
  /**
   * Resolve the signed-in customer from YOUR app's authenticated session
   * (session cookie, auth library, …). Return `null` when nobody is signed in.
   *
   * Must not read `buyerIdentity` or `storeId` from anything the browser
   * controls — query string, body, form fields or custom headers. Whoever
   * controls `buyerIdentity` gets that customer's portal.
   */
  resolveAuthenticatedCustomer: (request: Request) => Promise<AuthenticatedPortalCustomer | null> | AuthenticatedPortalCustomer | null;
  /**
   * Where to send a visitor for whom the resolver returned `null`. A path or
   * absolute URL, resolved against the request URL; a function receives the
   * request (e.g. to add your own `returnTo`). Omit to answer 401 instead.
   *
   * Build it from constants or an allow-list, never by copying request
   * parameters verbatim (e.g. a `?next=` value) — that turns this route into an
   * open redirect.
   */
  loginUrl?: string | ((request: Request) => string);
  /**
   * Build the response when creating the portal link fails (API error, invalid
   * store ID, network error). This is the place for your own logging and error
   * reporting. Defaults to a 502 JSON `{ error }` response with a generic
   * message, after one `console.error` line carrying only the error message;
   * the error itself is not echoed to the browser.
   */
  onError?: (error: unknown, request: Request) => Response | Promise<Response>;
}

/** GET Route Handler returned by {@link createCustomerPortalRedirect}. */
export type CustomerPortalRouteHandler = (request: Request) => Promise<Response>;

/**
 * Build headers for a portal route response. Every response — redirect, 401 or
 * error — is `no-store` and `no-referrer`, so a tokenized `Location` is neither
 * cached nor forwarded as a Referer.
 */
function portalHeaders(extra: Record<string, string>): Headers {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  return headers;
}

/**
 * One-line, log-safe description of a portal link failure: the error message
 * only (never the error object, which may carry a response body), with any
 * `#token=...` fragment redacted.
 */
function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/#token=[^\s"'&]*/g, "#token=[redacted]").replace(/\s+/g, " ");
}

/**
 * Create a GET Route Handler that sends the signed-in customer to your store's
 * Pancake customer portal, without the portal's email verification step.
 *
 * Behavior:
 * - Calls `resolveAuthenticatedCustomer(request)` — your own session check — to
 *   get `{ storeId, buyerIdentity }`. Nothing is read from the request's query
 *   string, body or headers by the SDK
 * - Signed in: creates a portal link with `client.auth.createCustomerPortalLink()`
 *   and answers `302` to `portalUrl` (which carries `#token=...`)
 * - Not signed in: `302` to `loginUrl` when set, otherwise `401`
 * - Link creation fails: `onError(error, request)`, or by default one server-side
 *   `console.error` line with the error message and a generic `502 { error }`
 *
 * Side effects:
 * - One signed API request per signed-in visit; each visit issues a new portal session
 * - Every response it builds (not a custom `onError` one) sets `Cache-Control: no-store` and `Referrer-Policy: no-referrer`
 *   so the tokenized `Location` is neither cached nor forwarded as a Referer
 *
 * Boundary conditions:
 * - The portal environment is the environment of the API Key in `config`
 *   (test key → test portal, prod key → prod portal)
 * - Errors thrown by `resolveAuthenticatedCustomer` propagate (Next.js answers 500)
 * - The default error log is the message only, with any `#token=` fragment redacted;
 *   pass `onError` to log or report failures your own way
 * - `loginUrl` must not echo request parameters verbatim, or the route becomes an open redirect
 *
 * A Route Handler rather than a Server Action: the portal entry is a plain link
 * navigation, and only an HTTP redirect keeps the tokenized URL out of client
 * JavaScript while letting the response carry `no-store` / `no-referrer`.
 *
 * @param config - WaffoPancake client configuration (merchantId + privateKey)
 * @param options - Session resolver, login redirect and error handling
 * @returns A Next.js GET Route Handler
 *
 * @example
 * ```ts
 * // app/account/billing-portal/route.ts
 * import { createCustomerPortalRedirect } from "@waffo/pancake-nextjs/server";
 * import { auth } from "@/lib/auth"; // your auth library
 *
 * export const dynamic = "force-dynamic";
 *
 * export const GET = createCustomerPortalRedirect(
 *   { merchantId: process.env.WAFFO_MERCHANT_ID!, privateKey: process.env.WAFFO_PRIVATE_KEY! },
 *   {
 *     resolveAuthenticatedCustomer: async () => {
 *       const session = await auth();
 *       if (!session?.user) return null;
 *       return { storeId: process.env.WAFFO_STORE_ID!, buyerIdentity: session.user.id };
 *     },
 *     loginUrl: "/login?returnTo=/account/billing-portal",
 *   },
 * );
 * // In a page: <a href="/account/billing-portal">Manage billing</a>
 * ```
 */
export function createCustomerPortalRedirect(
  config: WaffoPancakeConfig,
  options: CustomerPortalRedirectOptions,
): CustomerPortalRouteHandler {
  const client = new WaffoPancake(config);

  return async function GET(request: Request): Promise<Response> {
    const customer = await options.resolveAuthenticatedCustomer(request);

    if (!customer) {
      if (options.loginUrl === undefined) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: portalHeaders({ "Content-Type": "application/json" }),
        });
      }
      const loginUrl = typeof options.loginUrl === "function" ? options.loginUrl(request) : options.loginUrl;
      return new Response(null, {
        status: 302,
        headers: portalHeaders({ Location: new URL(loginUrl, request.url).toString() }),
      });
    }

    let portalUrl: string;
    try {
      ({ portalUrl } = await client.auth.createCustomerPortalLink({
        storeId: customer.storeId,
        buyerIdentity: customer.buyerIdentity,
      }));
    } catch (error) {
      if (options.onError) {
        return options.onError(error, request);
      }
      console.error("[waffo-pancake] createCustomerPortalRedirect failed:", safeErrorMessage(error));
      return new Response(JSON.stringify({ error: "Failed to create customer portal link" }), {
        status: 502,
        headers: portalHeaders({ "Content-Type": "application/json" }),
      });
    }

    return new Response(null, {
      status: 302,
      headers: portalHeaders({ Location: portalUrl }),
    });
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
