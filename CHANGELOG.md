# Changelog

All notable changes to `@waffo/pancake-nextjs` will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-10

### Added

- **`<CheckoutButton>`** — React component that triggers checkout on click. Supports anonymous and authenticated modes, redirect (default) and popup navigation. Avoids popup blockers by synchronously opening the window in the click handler.
- **`useCheckout()`** — React hook for programmatic checkout flow. Returns `{ checkout, isLoading, error }`. Same popup blocker avoidance.
- **Two navigation modes** — `mode="redirect"` (default): `window.location.href` navigation. `mode="popup"`: opens a new window with a loading page, then navigates to checkout URL.
