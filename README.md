# @waffo/pancake-nextjs

Next.js SDK for the [Waffo Pancake](https://waffo.ai) Merchant of Record (MoR) payment platform.

- Three checkout modes: link (instant redirect), anonymous (API), authenticated (API + token)
- Popup blocker avoidance — synchronous `window.open` in click handler
- Webhook route handler with automatic signature verification and event dispatch
- Customer self-service hooks with automatic token lifecycle management
- Server action architecture — private keys never leave the server

## Installation

```bash
npm install @waffo/pancake-nextjs
```

## Quick Start

> Most merchants create stores and products in the [Dashboard](https://pancake.waffo.ai/dashboard). This SDK is primarily used for **embedding checkout, webhooks, and customer self-service** into your Next.js app.

The fastest integration — a link checkout button, no API keys needed:

```tsx
import { CheckoutButton } from "@waffo/pancake-nextjs";

// Product ID and store slug are available in Dashboard > Products
<CheckoutButton type="link" storeSlug="my-store" productId="PROD_xxx" currency="USD">
  Buy Now
</CheckoutButton>;
```

For API-level control (dynamic pricing, customer identity, trial overrides), set up server actions first:

```ts
// app/lib/waffo.ts — define once, import everywhere
"use server";
import {
  createCheckoutAction,
  createCustomerTokenAction,
  createCustomerSessionAction,
  createMerchantQueryAction,
} from "@waffo/pancake-nextjs/server";

// Merchant ID and API Key are available in Dashboard > Settings > Developers
const config = {
  merchantId: process.env.WAFFO_MERCHANT_ID!,
  privateKey: process.env.WAFFO_PRIVATE_KEY!,
  // Required by createCustomerSessionAction — session tokens carry no environment
  environment: "test" as const,
};

export const checkout = createCheckoutAction(config);
export const issueCustomerToken = createCustomerTokenAction(config);
export const customerAction = createCustomerSessionAction(config);
export const merchantQuery = createMerchantQueryAction(config);
```

Private keys are captured in server action closures — they never reach the browser.

## Checkout Integration

Waffo supports three checkout modes based on how much control the merchant needs:

| Mode              | `type`            | Needs Server Action? | Use Case                                                                                 |
| ----------------- | ----------------- | :------------------: | ---------------------------------------------------------------------------------------- |
| **Link**          | `"link"`          |          No          | Landing pages, email campaigns. Redirects to product page which auto-creates a session.  |
| **Anonymous**     | omit              |         Yes          | API-level control without customer identity. Customer fills in details on checkout page. |
| **Authenticated** | `"authenticated"` |         Yes          | Merchant provides customer identity. Form pre-filled. Enables customer self-service.     |

Changing the plan of an existing subscription is a fourth shape of the same server action — see [Plan Change Links](#plan-change-links).

> **We recommend authenticated checkout whenever possible.** It binds orders to a stable merchant-controlled identifier. In anonymous mode, the customer self-reports their email — if they enter a different address, previous orders become unlinked and subscription trial periods can be exploited.

### Link Checkout

No server action needed. Builds a product page URL and redirects directly:

```tsx
import { CheckoutButton } from "@waffo/pancake-nextjs";

// Basic
<CheckoutButton type="link" storeSlug="my-store" productId="PROD_xxx" currency="USD">
  Buy Now — $29
</CheckoutButton>

// With all options
<CheckoutButton
  type="link"
  storeSlug="my-store"
  productId="PROD_xxx"
  currency="USD"
  email="customer@example.com"
  successUrl="https://example.com/thank-you"
  country="US"
  test={false}
>
  Buy Now
</CheckoutButton>
```

Add `discountCode` to apply a coupon code or promotion code on the product page, for one-time and subscription products. It is sent as `discount_code`; the code is applied and locked, so the customer sees the discount but cannot change or remove it. Without `discountCode`, the product page shows a code entry field. On a subscription the coupon's duration decides how many billing periods are discounted — a free trial uses no discount, and it starts with the first paid period; a paid trial is discounted and counts as the first period. A product link never starts a plan change; for discounts on plan changes, see [Plan Change Links](#plan-change-links).

```tsx
<CheckoutButton type="link" storeSlug="my-store" productId="PROD_xxx" currency="USD" discountCode="SPRING-20">
  Buy Now — 20% off
</CheckoutButton>
```

### Anonymous Checkout

Creates a checkout session via server action, then redirects:

```tsx
import { CheckoutButton } from "@waffo/pancake-nextjs";
import { checkout } from "./lib/waffo";

// Basic — use product's stored price
<CheckoutButton action={checkout} productId="PROD_xxx" currency="USD">
  Buy Now
</CheckoutButton>

// Dynamic pricing — override with a coupon or volume discount
<CheckoutButton action={checkout} productId="PROD_xxx" currency="USD" priceSnapshot={{ amount: "19.99", taxCategory: "digital_goods" }}>
  Buy Now — $19.99 (20% off)
</CheckoutButton>

// Subscription with trial control + billing pre-fill
<CheckoutButton action={checkout} productId="PROD_xxx" currency="USD" withTrial={true} billingDetail={{ country: "JP", isBusiness: false }}>
  Start Free Trial
</CheckoutButton>

// Set the default checkout language (IETF BCP 47) — the customer can still switch on the page
<CheckoutButton action={checkout} productId="PROD_xxx" currency="USD" language="pt-BR">
  Comprar agora
</CheckoutButton>

// Select the payment methods offered on the checkout page (whitelist or blacklist, not both)
<CheckoutButton action={checkout} productId="PROD_xxx" currency="USD" includePaymentMethods={["card", "applepay"]}>
  Buy Now
</CheckoutButton>
```

Pass an optional `orderMerchantExternalId` to attach your internal order reference — see [Business-Side Identifiers](#business-side-identifiers).

#### Discounts

Pass `allowPromotionCodes` to show a code entry field on the checkout page (sessions created through the server action default to no field). The server action forwards it to the platform, which checks every code the customer enters.

```tsx
<CheckoutButton action={checkout} productId="PROD_xxx" currency="USD" allowPromotionCodes>
  Buy Now
</CheckoutButton>
```

`couponId` and `promotionCode` cannot be set from the browser. A Server Action is callable with any arguments and `createCheckoutAction` signs with your API Key, so a customer could otherwise apply any of your coupons, or prefill any promotion code as if you had chosen it, on their own purchase: the action strips `couponId` and `promotionCode` on every flow, plan changes included. To apply a coupon the customer cannot change, or prefill a promotion code, decide who is entitled to it in your own server code and call `@waffo/pancake-ts` there:

```ts
// app/actions/vip-checkout.ts
"use server";
import { WaffoPancake } from "@waffo/pancake-ts";

const client = new WaffoPancake({ merchantId: process.env.WAFFO_MERCHANT_ID!, privateKey: process.env.WAFFO_PRIVATE_KEY! });

export async function vipCheckout() {
  const user = await requireVipUser(); // your own session check
  const { checkoutUrl } = await client.checkout.authenticated.create({
    productId: "PROD_xxx",
    currency: "USD",
    buyerIdentity: user.id,
    couponId: "CPN_xxx",
  });
  return checkoutUrl;
}
```

Build that call from your own fields — do not spread parameters received from the browser into a server-side call that sets `couponId` or `promotionCode`. A browser-supplied `allowPromotionCodes` would ride along: `couponId` together with `promotionCode` or `allowPromotionCodes` (either value) is rejected locally by the SDK with a 400 before any request is sent, and `allowPromotionCodes: true` next to your `promotionCode` would let the customer change or remove it.

### Authenticated Checkout (Recommended)

Creates a session **and** a token bound to the customer you provide. `buyerIdentity` is for order attribution and trial tracking — it is not rendered on the checkout page. To pre-fill the email field on the checkout form, pass `buyerEmail` explicitly.

```tsx
import { CheckoutButton } from "@waffo/pancake-nextjs";
import { checkout } from "./lib/waffo";

// Basic — customer identity only (checkout page email field stays empty)
<CheckoutButton type="authenticated" action={checkout} productId="PROD_xxx" currency="USD" buyerIdentity={user.id}>
  Upgrade to Pro
</CheckoutButton>

// Dynamic pricing + popup mode + email pre-fill
<CheckoutButton
  type="authenticated"
  action={checkout}
  productId="PROD_xxx"
  currency="USD"
  buyerIdentity={user.id}
  buyerEmail={user.email}
  priceSnapshot={{ amount: "7.99", taxCategory: "saas" }}
  mode="popup"
  loadingChildren="Opening checkout..."
>
  Upgrade — $7.99/mo
</CheckoutButton>

// Full pre-fill — identity + email + billing + skip trial + your internal order ref
<CheckoutButton
  type="authenticated"
  action={checkout}
  productId="PROD_xxx"
  currency="USD"
  buyerIdentity={user.id}
  buyerEmail={user.email}
  billingDetail={{ country: "US", isBusiness: true, state: "CA" }}
  withTrial={false}
  successUrl="https://example.com/dashboard?upgraded=true"
  orderMerchantExternalId={internalOrderId} // optional, see Business-Side Identifiers below
>
  Skip Trial, Start Now
</CheckoutButton>
```

### useCheckout Hook

For programmatic control — same props as `CheckoutButton`, returns `{ checkout, isLoading, error }`:

```tsx


> Passing `billingDetail` couples the cashier to the order's billing country: it then offers only that country's
> payment market and the customer cannot switch. The country that applies is the one on the finished order, not the
> one you sent; a country outside the payment markets we cover applies no restriction. Omit it to leave the cashier
> unrestricted.
import { useCheckout } from "@waffo/pancake-nextjs";
import { checkout as checkoutAction } from "./lib/waffo";

const { checkout, isLoading, error } = useCheckout({
  type: "authenticated",
  action: checkoutAction,
  productId: "PROD_xxx",
  currency: "USD",
  buyerIdentity: user.id,
  buyerEmail: user.email,
});

<button onClick={checkout} disabled={isLoading}>
  {isLoading ? "Creating session..." : "Buy Now"}
</button>;
```

### Plan Change Links

Switching an existing subscription to another plan is issued server-side: the same `createCheckoutAction()` action takes `type: "planChange"` (or `"authenticatedPlanChange"`), with `originOrderId` required. The returned `checkoutUrl` points at the change confirmation page (`…/store/{slug}/change/{sessionId}`), so send the customer there instead of the cashier.

```tsx
// app/actions.ts
"use server";
import { ChangeTiming } from "@waffo/pancake-nextjs";
import { createCheckoutAction } from "@waffo/pancake-nextjs/server";

export const checkout = createCheckoutAction({
  merchantId: process.env.WAFFO_MERCHANT_ID!,
  privateKey: process.env.WAFFO_PRIVATE_KEY!,
});

// Anywhere on the server: issue the link and redirect
const session = await checkout({
  type: "planChange",
  originOrderId: "ORD_xxx", // the subscription being changed (required)
  productId: "PROD_target_plan", // the plan to switch to
  currency: "USD",
  changeTiming: ChangeTiming.Immediate, // omit to let the platform derive it
  changeCreditAmount: "8.00", // "credit this much" — or changeAmount, never both
});
redirect(session.checkoutUrl);

// Authenticated form: the customer session token is appended to the URL
const authed = await checkout({
  type: "authenticatedPlanChange",
  originOrderId: "ORD_xxx",
  productId: "PROD_target_plan",
  currency: "USD",
  buyerIdentity: user.id,
});
```

- `changeAmount` sets what you charge for this period, `changeCreditAmount` how much you credit against it — same unit and tax basis, opposite meaning, mutually exclusive, and sending both is rejected with a 400.
- `allowPromotionCodes` passes through to show a code entry field on the confirmation page; `couponId` and `promotionCode` are stripped, as on a new purchase — set them from your own server code with `@waffo/pancake-ts`. A coupon or code replaces the subscription's current discount; without one, the current discount carries over to the new plan with the periods already used, unless it has no periods left, its coupon's `redeemBy` is within 60 seconds, or the coupon is deactivated — then the new plan is charged the full price. See [Discounts](https://docs.waffo.ai/guides/discounts#subscriptions).
- There is no anonymous plan change: a Store Slug session has no subscription to attribute the change to, and the platform answers 403.
- To let customers start a change themselves, switch on `selfServicePlanChange` on the product group, then call the customer session action — that path is the only one the switch gates:

```tsx
// Server action from createCustomerSessionAction()
const session = await customerAction(customerToken, "createPlanChangeSession", {
  originOrderId: "ORD_xxx",
  productId: "PROD_target_plan",
  currency: "USD",
});
```

The customer path has three preconditions, each answered with 403: the subscription belongs to that customer, the target plan is in the **same product group**, and that group's `selfServicePlanChange` is on. Its params carry none of the merchant-only pricing fields — the platform drops them on this path without saying so. See [Idempotency](#idempotency) for retry safety.

### Navigation Modes

Both `CheckoutButton` and `useCheckout` support two navigation modes via the `mode` prop:

- `"redirect"` (default) — navigates the current page. Customer returns via `successUrl`.
- `"popup"` — opens a new tab. Link mode opens the URL directly; API modes show a loading page first, then redirect once the session is ready.

## Webhook Verification

After a customer completes payment, Waffo sends webhook events to your server. The `Webhook` factory creates a Next.js route handler that verifies signatures and dispatches events:

```ts
// app/api/webhooks/waffo/route.ts
import { Webhook } from "@waffo/pancake-nextjs";

export const POST = Webhook({
  verifyOptions: { environment: "prod" },

  // Event-specific handlers
  onOrderCompleted: async (event) => {
    console.log(`Order ${event.data.orderId} completed`);
    await grantAccess(event.data.orderId, event.data.buyerEmail);
  },
  onSubscriptionActivated: async (event) => {
    await enableSubscription(event.data.orderId);
  },
  onSubscriptionPaymentSucceeded: async (event) => {
    await extendAccess(event.data.orderId);
  },
  onSubscriptionCanceled: async (event) => {
    await revokeAccess(event.data.orderId);
  },
  onRefundSucceeded: async (event) => {
    // refund.* events carry both business identifiers (see Business-Side Identifiers section)
    await markRefunded({
      orderRef: event.data.orderMerchantExternalId,
      refundTicketRef: event.data.refundTicketMerchantExternalId,
    });
    await revokeAccess(event.data.orderId);
  },

  // Catch-all — fires for every event (optional)
  onPayload: async (event) => {
    console.log(`Received ${event.eventType}`, event.data);
  },
});
```

Returns `200` on success, `401` on invalid signature, `500` if a handler throws. Full event list: `onOrderCompleted`, `onSubscriptionActivated`, `onSubscriptionPaymentSucceeded`, `onSubscriptionRenewed`, `onSubscriptionRecovered`, `onSubscriptionPlanChanged`, `onSubscriptionPlanChangeScheduled`, `onSubscriptionPlanChangeFailed`, `onSubscriptionCanceling`, `onSubscriptionUncanceled`, `onSubscriptionCanceled`, `onSubscriptionPastDue`, `onRefundSucceeded`, `onRefundFailed`.

## Customer Self-Service

Beyond checkout, you can let customers manage their own orders and subscriptions. Wrap with `WaffoPancakeProvider` — it auto-issues tokens and refreshes them before expiry:

```tsx
import { WaffoPancakeProvider, useCustomer, useCustomerOrders, useCustomerPayments, useCustomerRefundTickets } from "@waffo/pancake-nextjs";
import { issueCustomerToken, customerAction } from "./lib/waffo";

// Wrap once — provider manages token lifecycle
export default function AccountLayout({ user }: { user: { email: string } }) {
  return (
    <WaffoPancakeProvider
      customer={{ identity: user.email, storeId: "STO_xxx", issueToken: issueCustomerToken, sessionAction: customerAction }}
    >
      <AccountPage />
    </WaffoPancakeProvider>
  );
}

// All hooks work without passing token or client
function AccountPage() {
  const { data: orders, isLoading, refetch } = useCustomerOrders();
  const { data: payments } = useCustomerPayments();
  const { data: tickets } = useCustomerRefundTickets();
  const customer = useCustomer();

  if (isLoading) return <p>Loading...</p>;

  return (
    <div>
      {/* Subscription management */}
      {orders?.subscriptionOrders.map((sub) => (
        <div key={sub.id}>
          <p>
            {sub.product?.name} — {sub.status}
          </p>
          {sub.status === "active" && <button onClick={() => customer.cancelSubscription.execute({ orderId: sub.id })}>Cancel</button>}
          {sub.status === "canceling" && (
            <button onClick={() => customer.reactivateSubscription.execute({ orderId: sub.id })}>Undo Cancellation</button>
          )}
        </div>
      ))}

      {/* Order history */}
      {orders?.onetimeOrders.map((order) => (
        <p key={order.id}>
          {order.product?.name} — {order.status}
        </p>
      ))}

      <button
        onClick={() =>
          customer.createRefundTicket.execute({
            paymentId: "PAY_xxx",
            reason: "Product not as described",
            requestedAmount: { amount: "29.00", currency: "USD" },
            refundTicketMerchantExternalId: `REF-${Date.now()}`, // optional, see Business-Side Identifiers below
          })
        }
      >
        Request Refund
      </button>
    </div>
  );
}
```

### Customer Hooks

| Hook                         | Returns                                                                                                                     |     Auto-fetches?      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | :--------------------: |
| `useCustomer()`              | `cancelSubscription`, `cancelOnetimeOrder`, `reactivateSubscription`, `createRefundTicket`, `resubmitRefundTicket`, `query` | No — call `.execute()` |
| `useCustomerOrders()`        | `{ onetimeOrders, subscriptionOrders }` with product, payments, billing cycle                                               |          Yes           |
| `useCustomerPayments()`      | Payment records — amount, status, failure reason                                                                            |          Yes           |
| `useCustomerRefundTickets()` | Refund tickets — status, reason, amount                                                                                     |          Yes           |

Action hooks return `{ execute, isLoading, error, data }`. Data hooks return `{ data, isLoading, error, refetch }`.

## Customer Portal (SSO)

Send a customer who is signed in to **your** app straight into your store's Pancake customer portal — orders, subscriptions and payments — without the portal's email verification step. `createCustomerPortalRedirect` returns a GET Route Handler; link to it from your UI.

```ts
// app/account/billing-portal/route.ts
import { createCustomerPortalRedirect } from "@waffo/pancake-nextjs/server";
import { auth } from "@/lib/auth"; // your auth library

export const dynamic = "force-dynamic"; // per-visit session check and redirect, never statically cached

export const GET = createCustomerPortalRedirect(
  { merchantId: process.env.WAFFO_MERCHANT_ID!, privateKey: process.env.WAFFO_PRIVATE_KEY! },
  {
    // Identity comes from YOUR session — never from the request's query, body or headers
    resolveAuthenticatedCustomer: async () => {
      const session = await auth();
      if (!session?.user) return null;
      return { storeId: process.env.WAFFO_STORE_ID!, buyerIdentity: session.user.id };
    },
    loginUrl: "/login?returnTo=/account/billing-portal", // omit to answer 401
  },
);
```

```tsx
<a href="/account/billing-portal">Manage billing</a>
```

| Situation                   | Response                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Resolver returns a customer | `302` to the portal URL (carries `#token=...`)                                                                    |
| Resolver returns `null`     | `302` to `loginUrl`, or `401 { error: "Unauthorized" }` when `loginUrl` is not set                                |
| Portal link creation fails  | `onError(error, request)` if given, otherwise one `console.error` line and `502 { error }` with a generic message |
| Resolver throws             | The error propagates (Next.js answers 500)                                                                        |

Every response the handler builds (all but a custom `onError` one) carries `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, so the tokenized `Location` is neither cached nor forwarded as a Referer.

- **Why a Route Handler, not a Server Action**: the portal entry is a plain link navigation. An HTTP redirect keeps the tokenized portal URL out of client JavaScript and lets the response set `no-store` / `no-referrer`; a Server Action would have to hand the URL to the browser to navigate. It follows the same factory shape as `Webhook()`, but lives in `/server` because it holds the private key.
- **`buyerIdentity` must be the value you use for authenticated checkout**, so the portal shows the orders placed under it. Whoever controls `buyerIdentity` gets that customer's portal — the resolver is the security boundary.
- **Environment follows the API Key** in `config`: a test key opens the test portal, a prod key the prod portal. `config.environment` is not used here.
- **When the portal session expires**, the customer comes back through this route and gets a new link.
- **Logging is yours to add in `onError`.** Without it, the handler writes one server-side line — `[waffo-pancake] createCustomerPortalRedirect failed: <error message>`, with any `#token=` fragment redacted — and never the error object, the portal URL or the request. Pass `onError` to send failures to your own logger or error tracker, and keep tokens and portal URLs out of what you record.
- **Do not build `loginUrl` by copying request parameters verbatim.** A string or function that echoes, say, `?next=` from the request into the redirect turns this route into an open redirect. Use constants, or validate against an allow-list of your own paths.

> **Do not build a portal entry on `createCustomerTokenAction`.** It is a generic token primitive that signs whatever `buyerIdentity` it is called with, and a Server Action can be invoked from the browser with arbitrary arguments. Exposed as an unauthenticated portal or sign-in entry, it hands out any customer's token. Use `createCustomerPortalRedirect`, which only takes identity from your resolver.

## Business-Side Identifiers

Attach your own internal references to a checkout or a refund ticket so cross-system reconciliation does not require Waffo IDs. Two flat keys, both optional (max 128 chars):

| Field                            | Attach via                         | Inherited by                                  |
| -------------------------------- | ---------------------------------- | --------------------------------------------- |
| `orderMerchantExternalId`        | `CheckoutButton` / `useCheckout`   | `Order`, `Payment` (incl. renewals), `Refund` |
| `refundTicketMerchantExternalId` | `useCustomer().createRefundTicket` | `RefundTicket`, `Refund`                      |

The same field name appears at every layer: prop / hook param, webhook payload (`event.data.orderMerchantExternalId` / `event.data.refundTicketMerchantExternalId`), and GraphQL types. A `refund.*` webhook event carries **both** keys (order key inherited from the originating order).

```tsx
// 1. Attach at checkout — value is bound to the order, every payment, and any
//    later refund of this order.
<CheckoutButton action={checkout} productId="PROD_xxx" currency="USD" orderMerchantExternalId={internalOrderId}>
  Pay {internalOrderId}
</CheckoutButton>;

// 2. Attach at refund-ticket creation — value is bound to the ticket and the
//    refund record once the PSP confirms.
const customer = useCustomer();
await customer.createRefundTicket.execute({
  paymentId: "PAY_xxx",
  reason: "Product not as described",
  requestedAmount: { amount: "29.00", currency: "USD" },
  refundTicketMerchantExternalId: internalRefundSlipId,
});

// 3. Read back from webhooks — same field name as you wrote.
export const POST = Webhook({
  onRefundSucceeded: async (event) => {
    await ledger.markRefunded({
      orderRef: event.data.orderMerchantExternalId, // from the originating order
      refundTicketRef: event.data.refundTicketMerchantExternalId, // from the originating refund ticket
    });
  },
});

// 4. Query by reference via the customer's GraphQL surface — same field name on every type.
const result = await customer.query({
  query: `query ($ref: String!) {
    onetimeOrders(filter: { orderMerchantExternalId: { eq: $ref } }) {
      id status orderMerchantExternalId
    }
  }`,
  variables: { ref: internalOrderId },
});
```

## Merchant Data

Pre-built hooks for merchant dashboards. Pass a server action and store ID:

```tsx
import { useMerchantSales, useMerchantOrders, useMerchantSubscriptions } from "@waffo/pancake-nextjs";
import { merchantQuery } from "./lib/waffo";

function Dashboard() {
  const storeId = "STO_xxx";
  const { data: sales } = useMerchantSales(merchantQuery, storeId);
  const { data: orders, refetch } = useMerchantOrders(merchantQuery, { storeId, limit: 10 });
  const { data: subs } = useMerchantSubscriptions(merchantQuery, storeId);

  // sales: { totalRevenue, totalOrders, totalCustomers, currency, ordersByStatus, revenueByPeriod }
  // orders: { onetimeOrders, subscriptionOrders } — each with product, payments, testMode
  // subs: { activeCount, cancelingCount, pastDueCount, totalCount, subscriptions }
}
```

All merchant hooks return `{ data, isLoading, error, refetch }`.

## Server Actions

| Factory                                         | Returns                      | Description                                                                                                                                                                         |
| ----------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createCheckoutAction(config)`                  | `CheckoutAction`             | Checkout session creation (anonymous + authenticated) and plan change links (`planChange` + `authenticatedPlanChange`); strips `couponId` and `promotionCode` sent from the browser |
| `createCustomerTokenAction(config)`             | `CustomerTokenAction`        | Customer session token issuance                                                                                                                                                     |
| `createCustomerPortalRedirect(config, options)` | `CustomerPortalRouteHandler` | GET Route Handler: 302 to the customer portal for the customer your session resolver returns — see [Customer Portal (SSO)](#customer-portal-sso)                                    |
| `createCustomerSessionAction(config)`           | `CustomerSessionAction`      | Customer self-service operations                                                                                                                                                    |
| `createMerchantQueryAction(config)`             | `MerchantQueryAction`        | Merchant GraphQL queries                                                                                                                                                            |

Import from `@waffo/pancake-nextjs/server`. Config requires `merchantId` and `privateKey`. `createCustomerTokenAction` signs any `buyerIdentity` it receives: call it only with identity from your own session, never as an unauthenticated portal or sign-in entry.

## Idempotency

**No idempotency key is sent unless you pass one.** Neither this package nor `@waffo/pancake-ts` derives keys, so a write that times out and gets retried executes a second time.

Every server action takes an optional trailing options object that is forwarded to the SDK:

```tsx
// Checkout / plan change
const session = await checkout({ productId: "PROD_xxx", currency: "USD" }, { idempotencyKey: `MER_checkout-${cartId}` });

// Customer self-service
await customerAction(token, "createRefundTicket", ticketParams, { idempotencyKey: `MER_refund-${orderId}` });
```

With a key: the first request executes and its 2xx response is cached for **24 hours**, the same key returns that cached response, the same key while the original is in flight returns **409**, and a non-2xx original leaves the key free to retry. Without one nothing is deduplicated.

Uniqueness is yours to guarantee (at most 256 characters of letters, numbers, hyphens and underscores; a malformed key is rejected with a 400), and one key must not be reused across two different calls. `createMerchantQueryAction` takes no options — GraphQL queries are reads.

## Exports

### Classes & Enums

| Export              | Description                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `WaffoPancakeError` | API error with HTTP status and call-stack errors                                                 |
| `TaxCategory`       | `DigitalGoods`, `SaaS`, `Software`, `Ebook`, `OnlineCourse`, `Consulting`, `ProfessionalService` |
| `ChangeTiming`      | `Immediate`, `NextPeriod` — when a plan change takes effect                                      |
| `WebhookEventType`  | `OrderCompleted`, `SubscriptionActivated`, `SubscriptionCanceled`, etc.                          |

### Types

Key types: `PriceInfo`, `PriceSnapshot`, `BillingDetail`, `RequestOptions`, `WebhookEvent`, `CheckoutAction`, `CustomerTokenAction`, `CustomerSessionAction`, `MerchantQueryAction`, `CustomerPortalRouteHandler`, `CustomerPortalRedirectOptions`, `AuthenticatedPortalCustomer`, `CustomerConfig`, `CheckoutButtonProps`, `CheckoutMode`, `CashierLanguage`, `UseCheckoutReturn`, `UseCustomerReturn`, `CustomerActionState<T>`, `QueryState<T>`, `SalesOverview`, `SubscriptionOverview`, `WebhookConfig`.

## Development

```bash
npm run lint            # ESLint 9 (TypeScript ESLint + import order + JSDoc + react-hooks)
npm run test            # Vitest (jsdom)
npm run test:watch      # Vitest in watch mode
npm run test:coverage   # Vitest with v8 coverage
npm run build           # tsup → client (ESM+CJS "use client") + server (ESM+CJS)
```

## Project Structure

```
src/
├── index.ts               # Client barrel export ("use client")
├── server.ts              # Server barrel export (action factories)
├── types.ts               # Shared type definitions
├── provider.tsx           # <WaffoPancakeProvider> — token lifecycle
├── checkout-button.tsx    # <CheckoutButton> component
├── use-checkout.ts        # useCheckout() — link + anonymous + authenticated
├── use-customer.ts        # useCustomer() — customer actions
├── use-customer-data.ts   # useCustomerOrders / useCustomerPayments / useCustomerRefundTickets
├── use-merchant-data.ts   # useMerchantOrders / useMerchantSales / useMerchantSubscriptions
├── use-query.ts           # Shared useQuery helper
├── webhook.ts             # Webhook() route handler factory
└── __tests__/
```

## License

MIT
