# Changelog

All notable changes to `@waffo/pancake-nextjs` will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.7] - 2026-05-21

### Changed

- **Bumped peer `@waffo/pancake-ts` to `^0.9.0`** to pick up the new flat dual-key external-id fields. The wrapper surfaces these transparently — `CheckoutButton` / `useCheckout` now accept `orderMerchantExternalId`; `useBuyer().createRefundTicket` accepts `refundTicketMerchantExternalId`. See [`@waffo/pancake-ts@0.9.0` CHANGELOG](https://github.com/waffo-com/waffo-pancake-sdk-ts/blob/main/CHANGELOG.md#090---2026-05-21) for the full additive surface.

## [0.1.6] - 2026-05-17

### Changed

- **Bumped peer `@waffo/pancake-ts` to `^0.8.0`** to pick up the envelope-unification fixes:
  - GraphQL queries now actually return data (prior `@waffo/pancake-ts` versions stripped one envelope layer too many, leaving `result.data` undefined). `use-merchant-data.ts` and `use-buyer-data.ts` hooks transitively benefit.
  - GraphQL queries no longer carry `X-Idempotency-Key`, so subsequent identical queries hit the live DB instead of the gateway's 24h cache.
  - REST `warnings` (with `aiHint` migration notices) are no longer dropped on the way back through the SDK.

No source changes in this package; behavior changes flow through `@waffo/pancake-ts`. See [`@waffo/pancake-ts` 0.8.0 release notes](../waffo-pancake-sdk-ts/CHANGELOG.md#080---2026-05-17) for full details and caller migration guidance.

## [0.1.5] - 2026-04-22

### Added

- **MIT LICENSE file** — repository now includes the full MIT license text. `LICENSE` is also included in the npm package via the `files` field.

## [0.1.3] - 2026-04-18

### Changed

- **Dependency `@waffo/pancake-ts` bumped to `^0.5.0`** — picks up enriched `WebhookEventData` with full transaction chain fields (order status, payment details, subscription info, refund data, metadata). Webhook handlers automatically receive the new fields via the existing `EventHandler<WebhookEventData>` generic type.

## [0.1.2] - 2026-04-15

### Fixed

- **`useBuyerRefundTickets`** — the underlying GraphQL query was selecting non-existent top-level fields (`reason`, `requestedAmount`, `requestedCurrency`); these live under `versionData` because each ticket can have multiple submissions. Query now selects `versionData { reason, requestedAmount { amount, currency } }` and `versionNumber`. The `BuyerRefundTicket` interface is updated accordingly. **Breaking shape change for any consumer that read these fields**: replace `ticket.reason` → `ticket.versionData?.reason`, and `ticket.requestedAmount` → `ticket.versionData?.requestedAmount?.amount` (now display-formatted, e.g. `"29.00"`, paired with `requestedAmount.currency`).

### Compatibility

- **`useMerchantSales`** — `SalesOverview.totalRevenue` and `SalesOverview.revenueByPeriod[].amount` are now display-formatted strings (e.g. `"9.99"`) instead of minor-currency-unit strings. The TypeScript type is unchanged (`string`), but consumers must drop any `parseInt() / 100` or similar conversion. JSDoc updated to reflect the semantic. Aligns with `waffo-pancake-graphql-service` v2026.04.15.1.

### Changed

- **Dependency `@waffo/pancake-ts` bumped to `^0.4.1`** — to pick up the new `RefundTicketVersionData` type. `BuyerRefundTicket.versionData` now uses that shared type instead of a locally redefined one.

### Added

- **Re-exports from `@waffo/pancake-ts`** — `RequestedAmount` and `RefundTicketVersionData` are now re-exported from this package for direct use in client components.

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
