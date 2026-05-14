# Design: GDPR Webhooks + Quality (Items 6–8)

**Date:** 2026-05-14
**Scope:** `apps/loyalty-engine/`
**Goal:** Satisfy Shopify App Store GDPR requirements and ship referral reconciliation, test coverage, and Sentry monitoring.

---

## 1. GDPR Webhooks

### Why

Shopify requires all App Store apps to handle three mandatory GDPR webhooks. The submission review will hard-reject without them.

### Customer data inventory

The engine stores customer data in Shopify metafields only (namespace `$app`):

| Key | Type | Contains |
|-----|------|----------|
| `loyalty_state` | json | Tier, metrics, awardedRules, lastOrderId |
| `loyalty_points_balance` | number_integer | Points balance |
| `loyalty_active_redemption` | json | Active discount token |
| `loyalty_referred_by` | json | Referrer attribution payload |
| `loyalty_referred_by_credited` | boolean | Referral credit flag |

No customer PII is stored outside Shopify (Prisma holds shop sessions only).

### Handlers

**`webhooks.customers.data-request.tsx`** → `customers/data_request`

Shopify sends this when a customer requests their data. All loyalty data lives in Shopify's own metafield infra, so no external export is needed. Handler logs the request with customer and shop identifiers and returns 200. This satisfies the requirement — the data is accessible directly from Shopify.

**`webhooks.customers.redact.tsx`** → `customers/redact`

Shopify sends this after a customer requests erasure (48h after request). Handler deletes all 5 customer metafield keys via `metafieldsDelete` Admin API mutation. Uses the customer's admin GID from the webhook payload. Returns 200 even on partial failure (logs errors per key); Shopify will retry on non-2xx.

**`webhooks.shop.redact.tsx`** → `shop/redact`

Shopify sends this 48h after a shop uninstalls the app. Handler deletes all Prisma sessions for that shop (the only engine-owned storage outside Shopify). Pattern mirrors `webhooks.app.uninstalled.tsx` which already handles session cleanup on uninstall — shop/redact is the deferred version.

### toml registration

Add three `[[webhooks.subscriptions]]` entries to `shopify.app.toml`:

```toml
[[webhooks.subscriptions]]
topics = [ "customers/data_request" ]
uri = "/webhooks/customers/data-request"

[[webhooks.subscriptions]]
topics = [ "customers/redact" ]
uri = "/webhooks/customers/redact"

[[webhooks.subscriptions]]
topics = [ "shop/redact" ]
uri = "/webhooks/shop/redact"
```

---

## 2. Referral Partial Failure Reconciliation (Item 6)

### Problem

In `webhooks.orders-paid.tsx`, if `creditReferrerForFirstPaidOrder` throws after the referee's state is already written, the referrer silently loses their points. The current handler catches the error, logs it, and returns 200. There is no recovery path.

### Solution: manual reconciliation action on Customers page

Add a server action to `app.customers.tsx` that:

1. Queries all customers with `loyalty_referred_by` metafield set and `loyalty_referred_by_credited = false`.
2. For each result, re-attempts `creditReferrerForFirstPaidOrder` + `markRefereeReferralCredited`.
3. Returns a summary: `{ attempted, succeeded, failed }`.

Surface this as a "Reconcile pending referrals" button in the Customers admin page UI. Show the result inline (success count, any failed customer IDs for manual follow-up).

**Why not a scheduled job:** Single-merchant scale. A scheduled job adds infra complexity (cron, persistent state) that isn't warranted when an operator can click a button if they notice a discrepancy.

**New server function:** `reconcilePendingReferrals(admin, program)` in `app/loyalty/customer-state.server.ts`.

**New GraphQL query:** Fetch customers with `loyalty_referred_by` set and `loyalty_referred_by_credited = false` via Admin API customer search (metafield filter).

---

## 3. Test Coverage (Item 7)

### Approach

Add `vitest` to `devDependencies`. Target **pure domain functions only** — they have no IO, are already isolated, and cover the critical business logic that could silently produce wrong balances if broken.

No mocking of Shopify Admin API in this sprint. Route-level integration tests are a separate future sprint.

### Test files

All under `src/__tests__/`:

**`domain/program.test.ts`**
- `computeOrderPoints`: active order rule flat value, active order rule 1pt/$1 default, inactive rule skipped, zero amount, multiple active rules sum
- `getOneShotEarnPoints`: active rule returns value, inactive rule returns 0, missing action returns 0

**`domain/customer-state.test.ts`**
- `buildCustomerLoyaltyState`: correct tier computed from metrics, awardedRules deduplicated, lastOrderId included when provided, legacy state (no awardedRules) doesn't crash
- `getQualifiedTiers`: lifetime_spend threshold, paid_order_count threshold, points_balance threshold

**`src/webhooks/orders-paid.test.ts`**
- `getOrdersPaidCustomerAdminId`: prefers admin_graphql_api_customer_id, falls back to customer.id, returns null when both absent
- `getOrdersPaidOrderGid`: prefers admin_graphql_api_id, falls back to id, returns null when both absent
- `getOrdersPaidOrderAmount`: parses valid string, returns 0 for missing/negative/non-numeric

**`src/webhooks/orders-refunded.test.ts`**
- `getOrdersRefundedAmount`: sums multiple refund transactions, skips non-refund kinds, skips failed transactions, returns 0 for empty refunds
- `computeRefundPointsDebit`: mirrors computeOrderPoints — debit matches earn for same amount, inactive rule produces 0 debit

### vitest config

Add `vitest.config.ts` at `apps/loyalty-engine/` root. No jsdom needed (pure Node logic). Add `"test": "vitest run"` script to `package.json`.

---

## 4. Monitoring — Sentry (Item 8)

### What

Replace `console.error` in production error paths with `Sentry.captureException` so failures generate alerts rather than silent log lines on Fly.

### Implementation

**Install:** `@sentry/node` in `dependencies`.

**Init:** `app/entry.server.tsx` — call `Sentry.init({ dsn: process.env.SENTRY_DSN })` at module load. Guard with `if (process.env.SENTRY_DSN)` so local dev without a DSN doesn't crash.

**Instrument:** Replace `console.error` with `Sentry.captureException(error, { extra: { ... } })` in:
- `webhooks.orders-paid.tsx` — projection failure, sync failure, referral credit failure
- `webhooks.orders-refunded.tsx` — rollback failure
- `webhooks.metaobjects.tsx` — sync failure

Keep `console.error` alongside Sentry calls so Fly logs remain readable.

**Env:** Add `SENTRY_DSN` to `.env.example` (optional, no default). Add to Fly secrets docs.

**Not in scope:** Source maps upload, performance tracing, user context enrichment — those are future.

---

## File change summary

| File | Change |
|------|--------|
| `app/routes/webhooks.customers.data-request.tsx` | New |
| `app/routes/webhooks.customers.redact.tsx` | New |
| `app/routes/webhooks.shop.redact.tsx` | New |
| `shopify.app.toml` | Add 3 webhook subscriptions |
| `app/loyalty/customer-state.server.ts` | Add `reconcilePendingReferrals` |
| `app/routes/app.customers.tsx` | Add reconcile action + button |
| `src/__tests__/domain/program.test.ts` | New |
| `src/__tests__/domain/customer-state.test.ts` | New |
| `src/__tests__/webhooks/orders-paid.test.ts` | New |
| `src/__tests__/webhooks/orders-refunded.test.ts` | New |
| `vitest.config.ts` | New |
| `package.json` | Add vitest dev dep + test script |
| `app/entry.server.tsx` | Sentry init |
| `webhooks.orders-paid.tsx` | Sentry.captureException |
| `webhooks.orders-refunded.tsx` | Sentry.captureException |
| `webhooks.metaobjects.tsx` | Sentry.captureException |
| `.env.example` | Add SENTRY_DSN |

---

## Success criteria

- `shopify app deploy` succeeds with all 3 GDPR webhooks registered
- "Reconcile pending referrals" button in Customers page re-credits affected customers
- `npm test` runs 4 test files, all green
- Sentry receives a test event after deploy (can trigger manually via a thrown exception in dev)
