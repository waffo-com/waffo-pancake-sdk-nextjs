# Changelog

All notable changes to `@waffo/pancake-nextjs` will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
