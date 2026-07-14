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
```

Pass an optional `orderMerchantExternalId` to attach your internal order reference — see [Business-Side Identifiers](#business-side-identifiers).

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

Returns `200` on success, `401` on invalid signature, `500` if a handler throws. Full event list: `onOrderCompleted`, `onSubscriptionActivated`, `onSubscriptionPaymentSucceeded`, `onSubscriptionCanceling`, `onSubscriptionUncanceled`, `onSubscriptionUpdated`, `onSubscriptionCanceled`, `onSubscriptionPastDue`, `onRefundSucceeded`, `onRefundFailed`.

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

| Factory                               | Returns                 | Description                                           |
| ------------------------------------- | ----------------------- | ----------------------------------------------------- |
| `createCheckoutAction(config)`        | `CheckoutAction`        | Checkout session creation (anonymous + authenticated) |
| `createCustomerTokenAction(config)`   | `CustomerTokenAction`   | Customer session token issuance                       |
| `createCustomerSessionAction(config)` | `CustomerSessionAction` | Customer self-service operations                      |
| `createMerchantQueryAction(config)`   | `MerchantQueryAction`   | Merchant GraphQL queries                              |

Import from `@waffo/pancake-nextjs/server`. Config requires `merchantId` and `privateKey`.

## Exports

### Classes & Enums

| Export              | Description                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `WaffoPancakeError` | API error with HTTP status and call-stack errors                                                 |
| `TaxCategory`       | `DigitalGoods`, `SaaS`, `Software`, `Ebook`, `OnlineCourse`, `Consulting`, `ProfessionalService` |
| `WebhookEventType`  | `OrderCompleted`, `SubscriptionActivated`, `SubscriptionCanceled`, etc.                          |

### Types

Key types: `PriceInfo`, `BillingDetail`, `WebhookEvent`, `CheckoutAction`, `CustomerTokenAction`, `CustomerSessionAction`, `MerchantQueryAction`, `CustomerConfig`, `CheckoutButtonProps`, `CheckoutMode`, `UseCheckoutReturn`, `UseCustomerReturn`, `CustomerActionState<T>`, `QueryState<T>`, `SalesOverview`, `SubscriptionOverview`, `WebhookConfig`.

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
