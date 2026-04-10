# @waffo/pancake-nextjs

Next.js SDK for the [Waffo Pancake](https://waffo.ai) Merchant of Record (MoR) payment platform.

- Three checkout modes: link (instant redirect), anonymous (API), authenticated (API + token)
- Popup blocker avoidance — synchronous `window.open` in click handler
- Webhook route handler with automatic signature verification and event dispatch
- Buyer self-service hooks with automatic token lifecycle management
- Server action architecture — private keys never leave the server

## Installation

```bash
npm install @waffo/pancake-nextjs
```

## Quick Start

> Most merchants create stores and products in the [Dashboard](https://pancake.waffo.ai/dashboard). This SDK is primarily used for **embedding checkout, webhooks, and buyer self-service** into your Next.js app.

The fastest integration — a link checkout button, no API keys needed:

```tsx
import { CheckoutButton } from "@waffo/pancake-nextjs";

// Product ID and store slug are available in Dashboard > Products
<CheckoutButton type="link" storeSlug="my-store" productId="PROD_xxx" currency="USD">
  Buy Now
</CheckoutButton>
```

For API-level control (dynamic pricing, buyer identity, trial overrides), set up server actions first:

```ts
// app/lib/waffo.ts — define once, import everywhere
"use server";
import {
  createCheckoutAction,
  createBuyerTokenAction,
  createBuyerSessionAction,
  createMerchantQueryAction,
} from "@waffo/pancake-nextjs/server";

// Merchant ID and API Key are available in Dashboard > Settings > Developers
const config = {
  merchantId: process.env.WAFFO_MERCHANT_ID!,
  privateKey: process.env.WAFFO_PRIVATE_KEY!,
};

export const checkout = createCheckoutAction(config);
export const issueBuyerToken = createBuyerTokenAction(config);
export const buyerAction = createBuyerSessionAction(config);
export const merchantQuery = createMerchantQueryAction(config);
```

Private keys are captured in server action closures — they never reach the browser.

## Checkout Integration

Waffo supports three checkout modes based on how much control the merchant needs:

| Mode | `type` | Needs Server Action? | Use Case |
|------|--------|:--------------------:|----------|
| **Link** | `"link"` | No | Landing pages, email campaigns. Redirects to product page which auto-creates a session. |
| **Anonymous** | omit | Yes | API-level control without buyer identity. Buyer fills in details on checkout page. |
| **Authenticated** | `"authenticated"` | Yes | Merchant provides buyer identity. Form pre-filled. Enables buyer self-service. |

> **We recommend authenticated checkout whenever possible.** It binds orders to a stable merchant-controlled identifier. In anonymous mode, the buyer self-reports their email — if they enter a different address, previous orders become unlinked and subscription trial periods can be exploited.

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
  email="buyer@example.com"
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

### Authenticated Checkout (Recommended)

Creates a session **and** a token. The checkout form arrives pre-filled with the buyer's identity:

```tsx
import { CheckoutButton } from "@waffo/pancake-nextjs";
import { checkout } from "./lib/waffo";

// Basic — form pre-filled with email
<CheckoutButton type="authenticated" action={checkout} productId="PROD_xxx" currency="USD" buyerIdentity={user.email}>
  Upgrade to Pro
</CheckoutButton>

// Dynamic pricing + popup mode (keeps your page open during checkout)
<CheckoutButton
  type="authenticated"
  action={checkout}
  productId="PROD_xxx"
  currency="USD"
  buyerIdentity={user.email}
  priceSnapshot={{ amount: "7.99", taxCategory: "saas" }}
  mode="popup"
  loadingChildren="Opening checkout..."
>
  Upgrade — $7.99/mo
</CheckoutButton>

// Full pre-fill — identity + billing + skip trial
<CheckoutButton
  type="authenticated"
  action={checkout}
  productId="PROD_xxx"
  currency="USD"
  buyerIdentity={user.email}
  billingDetail={{ country: "US", isBusiness: true, state: "CA" }}
  withTrial={false}
  successUrl="https://example.com/dashboard?upgraded=true"
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
  buyerIdentity: user.email,
});

<button onClick={checkout} disabled={isLoading}>
  {isLoading ? "Creating session..." : "Buy Now"}
</button>
```

### Navigation Modes

Both `CheckoutButton` and `useCheckout` support two navigation modes via the `mode` prop:

- `"redirect"` (default) — navigates the current page. Buyer returns via `successUrl`.
- `"popup"` — opens a new tab. Link mode opens the URL directly; API modes show a loading page first, then redirect once the session is ready.

## Webhook Verification

After a buyer completes payment, Waffo sends webhook events to your server. The `Webhook` factory creates a Next.js route handler that verifies signatures and dispatches events:

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
    await revokeAccess(event.data.orderId);
  },

  // Catch-all — fires for every event (optional)
  onPayload: async (event) => {
    console.log(`Received ${event.eventType}`, event.data);
  },
});
```

Returns `200` on success, `401` on invalid signature, `500` if a handler throws. Full event list: `onOrderCompleted`, `onSubscriptionActivated`, `onSubscriptionPaymentSucceeded`, `onSubscriptionCanceling`, `onSubscriptionUncanceled`, `onSubscriptionUpdated`, `onSubscriptionCanceled`, `onSubscriptionPastDue`, `onRefundSucceeded`, `onRefundFailed`.

## Buyer Self-Service

Beyond checkout, you can let buyers manage their own orders and subscriptions. Wrap with `WaffoPancakeProvider` — it auto-issues tokens and refreshes them before expiry:

```tsx
import { WaffoPancakeProvider, useBuyer, useBuyerOrders, useBuyerPayments, useBuyerRefundTickets } from "@waffo/pancake-nextjs";
import { issueBuyerToken, buyerAction } from "./lib/waffo";

// Wrap once — provider manages token lifecycle
export default function AccountLayout({ user }: { user: { email: string } }) {
  return (
    <WaffoPancakeProvider buyer={{ identity: user.email, storeId: "STO_xxx", issueToken: issueBuyerToken, sessionAction: buyerAction }}>
      <AccountPage />
    </WaffoPancakeProvider>
  );
}

// All hooks work without passing token or client
function AccountPage() {
  const { data: orders, isLoading, refetch } = useBuyerOrders();
  const { data: payments } = useBuyerPayments();
  const { data: tickets } = useBuyerRefundTickets();
  const buyer = useBuyer();

  if (isLoading) return <p>Loading...</p>;

  return (
    <div>
      {/* Subscription management */}
      {orders?.subscriptionOrders.map((sub) => (
        <div key={sub.id}>
          <p>{sub.product?.name} — {sub.status}</p>
          {sub.status === "active" && (
            <button onClick={() => buyer.cancelSubscription.execute({ orderId: sub.id })}>
              Cancel
            </button>
          )}
          {sub.status === "canceling" && (
            <button onClick={() => buyer.reactivateSubscription.execute({ orderId: sub.id })}>
              Undo Cancellation
            </button>
          )}
        </div>
      ))}

      {/* Order history */}
      {orders?.onetimeOrders.map((order) => (
        <p key={order.id}>{order.product?.name} — {order.status}</p>
      ))}
    </div>
  );
}
```

### Buyer Hooks

| Hook | Returns | Auto-fetches? |
|------|---------|:-------------:|
| `useBuyer()` | `cancelSubscription`, `cancelOnetimeOrder`, `reactivateSubscription`, `createRefundTicket`, `resubmitRefundTicket`, `query` | No — call `.execute()` |
| `useBuyerOrders()` | `{ onetimeOrders, subscriptionOrders }` with product, payments, billing cycle | Yes |
| `useBuyerPayments()` | Payment records — amount, status, failure reason | Yes |
| `useBuyerRefundTickets()` | Refund tickets — status, reason, amount | Yes |

Action hooks return `{ execute, isLoading, error, data }`. Data hooks return `{ data, isLoading, error, refetch }`.

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

| Factory | Returns | Description |
|---------|---------|-------------|
| `createCheckoutAction(config)` | `CheckoutAction` | Checkout session creation (anonymous + authenticated) |
| `createBuyerTokenAction(config)` | `BuyerTokenAction` | Buyer session token issuance |
| `createBuyerSessionAction(config)` | `BuyerSessionAction` | Buyer self-service operations |
| `createMerchantQueryAction(config)` | `MerchantQueryAction` | Merchant GraphQL queries |

Import from `@waffo/pancake-nextjs/server`. Config requires `merchantId` and `privateKey`.

## Exports

### Classes & Enums

| Export | Description |
|--------|-------------|
| `WaffoPancakeError` | API error with HTTP status and call-stack errors |
| `TaxCategory` | `DigitalGoods`, `SaaS`, `Software`, `Ebook`, `OnlineCourse`, `Consulting`, `ProfessionalService` |
| `WebhookEventType` | `OrderCompleted`, `SubscriptionActivated`, `SubscriptionCanceled`, etc. |

### Types

Key types: `PriceInfo`, `BillingDetail`, `WebhookEvent`, `CheckoutAction`, `BuyerTokenAction`, `BuyerSessionAction`, `MerchantQueryAction`, `BuyerConfig`, `CheckoutButtonProps`, `CheckoutMode`, `UseCheckoutReturn`, `UseBuyerReturn`, `BuyerActionState<T>`, `QueryState<T>`, `SalesOverview`, `SubscriptionOverview`, `WebhookConfig`.

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
├── use-buyer.ts           # useBuyer() — buyer actions
├── use-buyer-data.ts      # useBuyerOrders / useBuyerPayments / useBuyerRefundTickets
├── use-merchant-data.ts   # useMerchantOrders / useMerchantSales / useMerchantSubscriptions
├── use-query.ts           # Shared useQuery helper
├── webhook.ts             # Webhook() route handler factory
└── __tests__/
```

## License

MIT
