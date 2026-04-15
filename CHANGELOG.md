# Changelog

All notable changes to `@waffo/pancake-nextjs` will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-04-15

### Documentation

- **`<CheckoutButton type="authenticated">` examples** — README and JSDoc updated to show `buyerIdentity` and `buyerEmail` as independent inputs. `buyerIdentity` is for order attribution and trial tracking only and is not rendered on the checkout page; pass `buyerEmail` explicitly to pre-fill the email input. Examples now use `buyerIdentity={user.id}` to demonstrate that identity can be any merchant-controlled identifier.
- **`<WaffoPancakeProvider>` JSDoc** — `buyer.identity` example switched to `user.id` with a note clarifying the value must match the `buyerIdentity` used at checkout time, since buyer-portal lookups are keyed by `merchant_provided_buyer_identity`.

Reflects the upstream behavior change in `@waffo/pancake-ts@0.4.0`.

## [0.1.0] - 2026-04-10

### Added

- **`<WaffoPancakeProvider>`** — Context provider that manages the Waffo Pancake client and buyer token lifecycle. Auto-issues session tokens, caches in memory, refreshes 30s before expiry. All buyer hooks read from context — no manual token management.
- **`<CheckoutButton>`** — React component for one-click checkout. Three modes: `type="link"` (instant redirect, no API call), anonymous (API session), `type="authenticated"` (API session + token). All props flattened directly on the component. Popup blocker avoidance via synchronous `window.open`.
- **`useCheckout()`** — React hook for programmatic checkout flow. Same three modes as `CheckoutButton`. Returns `{ checkout, isLoading, error }`.
- **`Webhook()`** — Next.js route handler factory for webhook signature verification. Auto-dispatches to 10 event-specific handlers (`onOrderCompleted`, `onSubscriptionActivated`, `onRefundSucceeded`, etc.). Supports catch-all `onPayload` handler.
- **`useBuyer()`** — React hook for buyer self-service actions. Works with Provider (no args) or standalone (client + token). Actions: `cancelSubscription`, `cancelOnetimeOrder`, `reactivateSubscription`, `createRefundTicket`, `resubmitRefundTicket`, `query`.
- **`useBuyerOrders()`** — Fetch buyer's order history (one-time + subscription) with product info, payments, and billing cycle.
- **`useBuyerPayments()`** — Fetch buyer's payment records with amounts, status, and failure reasons.
- **`useBuyerRefundTickets()`** — Fetch buyer's refund tickets with status and requested amounts.
- **`useMerchantOrders(client, { storeId })`** — Fetch recent orders for a store.
- **`useMerchantSales(client, storeId)`** — Fetch sales overview: revenue, order count, customer count, status breakdown, revenue trend.
- **`useMerchantSubscriptions(client, storeId)`** — Fetch subscription overview: active/canceling/pastDue counts + full list.
- **Re-exports from `@waffo/pancake-ts`** — `WaffoPancake`, `WaffoPancakeError`, `TaxCategory`, `WebhookEventType`, `PriceInfo`, `BillingDetail`, `WebhookEvent`, `WaffoPancakeConfig`. One package, all imports.
