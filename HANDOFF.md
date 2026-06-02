# Loyalty engine — handover for Claude Code

## Current state

The engine is production-ready and targeting the Shopify App Store (demo vehicle for Amada Flow). All core features are implemented and type-checked. Two deploy steps are pending (see below).

---

## Architecture

The storefront and engine talk via a shared-secret HTTPS proxy:

1. Customer clicks Redeem on the Hydrogen rewards page.
2. Hydrogen route `app/routes/api.loyalty.redeem.tsx`:
   - Verifies `context.customerAccount.isLoggedIn()`.
   - Queries `CustomerIdQuery` to get the customer's admin GID server-side.
   - POSTs to `${env.LOYALTY_ENGINE_URL}/api/redeem` with `X-Loyalty-Engine-Secret` and `X-Shopify-Shop-Domain` headers.
3. Engine `app/routes/api.redeem.tsx`:
   - Constant-time compares the shared secret (`constantTimeEquals`).
   - Calls `applyRedemptionForCustomer` which validates balance, debits, and writes `loyalty_active_redemption` metafield.
4. Discount function reads `loyalty_active_redemption` at every cart eval, emits tier + redemption discount candidates.

Points awarding: `webhooks.orders-paid.tsx` → `fetchCustomerPointsState` → `computeOrderPoints` / `getOneShotEarnPoints` → `syncCustomerLoyaltyState`. Idempotency guard: `currentState.lastOrderId === orderGid` short-circuits re-processing on Shopify retries.

Refund rollback: `webhooks.orders-refunded.tsx` handles `refunds/create`. Computes debit via `computeRefundPointsDebit` (mirrors `computeOrderPoints`, only `order` earn rules reversed), floors balance at 0.

---

## File map

### Engine (`apps/loyalty-engine/`)

**Routes — admin UI**
- `app/routes/app.tsx` — top nav (Home, Customers, Reward programs, Settings)
- `app/routes/app._index.tsx` — home dashboard with inline on/off toggle
- `app/routes/app.customers.tsx` — paginated customer table + referral reconciliation action
- `app/routes/app.settings.tsx` — master Active/Paused toggle
- `app/routes/app.reward-programs.tsx` — re-exports `app._index.tsx` (split deferred)

**Routes — API**
- `app/routes/api.redeem.tsx` — shared-secret + admin auth; calls `applyRedemptionForCustomer`
- `app/routes/api.attribute-referral.tsx` — shared-secret + admin auth; writes referral attribution metafield
- `app/routes/health.tsx` — `GET /health` pings DB, returns 200/503

**Routes — webhooks**
- `app/routes/webhooks.orders-paid.tsx` — awards points on paid orders (idempotent)
- `app/routes/webhooks.orders-refunded.tsx` — debits points on refund
- `app/routes/webhooks.metaobjects.tsx` — syncs program snapshot when config metaobject changes
- `app/routes/webhooks.app.uninstalled.tsx` — clears Prisma sessions on uninstall
- `app/routes/webhooks.customers.data-request.tsx` — GDPR: logs request (data in Shopify metafields)
- `app/routes/webhooks.customers.redact.tsx` — GDPR: deletes all 5 customer loyalty metafields
- `app/routes/webhooks.shop.redact.tsx` — GDPR: deletes Prisma sessions for the shop

**Server logic**
- `app/loyalty/customer-state.server.ts` — `fetchCustomerPointsState`, `syncCustomerLoyaltyState`, `applyRedemptionForCustomer`, `clearRedemptionForCustomer`, `reconcilePendingReferrals`
- `app/loyalty/program.server.ts` — fetches all metaobject types; snapshot includes `enabled` flag
- `app/loyalty/settings.server.ts` — read/write program-enabled flag
- `app/loyalty/admin.server.ts` — tier save flow + customer-points backfill
- `app/loyalty/earn-rules-redemptions-admin.server.ts` — earn rule + redemption save
- `app/loyalty/graphql.server.ts` — typed `adminGraphql` wrapper
- `app/loyalty/constants.ts` — metaobject types, action codes, reward types

**Domain / shared**
- `src/domain/program.ts` — `LoyaltyTierConfig`, `LoyaltyEarnRuleConfig`, `computeOrderPoints`, `getOneShotEarnPoints`
- `src/domain/customer-state.ts` — `buildCustomerLoyaltyState`, `getQualifiedTiers`; includes `lastOrderId`
- `src/webhooks/orders-paid.ts` — payload types + helpers including `getOrdersPaidOrderGid`
- `src/webhooks/orders-refunded.ts` — `getOrdersRefundedAmount`, `computeRefundPointsDebit`
- `src/webhooks/metaobjects.ts` — `isLoyaltyConfigMetaobject`

**Tests**
- `src/__tests__/domain/program.test.ts` — `computeOrderPoints`, `getOneShotEarnPoints`
- `src/__tests__/domain/customer-state.test.ts` — `buildCustomerLoyaltyState`, `getQualifiedTiers`
- `src/__tests__/webhooks/orders-paid.test.ts` — payload helpers
- `src/__tests__/webhooks/orders-refunded.test.ts` — `getOrdersRefundedAmount`, `computeRefundPointsDebit`

**Config**
- `shopify.app.toml` — webhook subscriptions: `orders/paid`, `app/uninstalled`, `metaobjects/update`, `metaobjects/delete`, `refunds/create`
- `fly.toml` — `min_machines_running = 1`; `/health` check every 30s
- `vitest.config.ts` — `environment: 'node'`, runs `src/__tests__/**/*.test.ts`
- `.env.example` — all 8 required env vars documented

### Storefront (Hydrogen — repo root)
- `app/components/LoyaltyFloatingWidget.tsx` — bottom-sheet rewards launcher
- `app/routes/account.loyalty.tsx` — full rewards page
- `app/routes/api.loyalty.redeem.tsx` — proxy to engine
- `app/routes/api.ai-preview.tsx` — image gen, tier-locked
- `app/lib/loyalty.ts` + `app/lib/loyalty.server.ts` — types, defaults, parsing
- `app/lib/image-gen-quota.server.ts` — quota math + Admin API persist

---

## Pending deploy steps

```bash
# from apps/loyalty-engine/

# 1. Register refunds/create webhook + upload function extension
shopify app deploy

# 2. Ship server to Fly.io
flyctl deploy

# 3. Optional: enable error monitoring
flyctl secrets set SENTRY_DSN=<dsn-from-sentry.io>

# 4. Create Managed Pricing plans in Partner Dashboard
#    Partners → Apps → [app] → Pricing → Managed Pricing
#    - Free plan (no charge)
#    - Pro plan (recurring price, 14-day trial)
#    Then: flyctl secrets set SHOPIFY_APP_HANDLE=<app-handle>
```

After deploying, configure GDPR webhook URLs in the Shopify Partner Dashboard:
- Partners → Apps → [app] → Configuration → Privacy webhooks
- Customer data request: `https://amadaflow-loyalty.fly.dev/webhooks/customers/data-request`
- Customer redact: `https://amadaflow-loyalty.fly.dev/webhooks/customers/redact`
- Shop redact: `https://amadaflow-loyalty.fly.dev/webhooks/shop/redact`

---

## Environment variables

| Var | Where set | Notes |
|-----|-----------|-------|
| `SHOPIFY_API_KEY` | Fly secrets | From Partners dashboard |
| `SHOPIFY_API_SECRET` | Fly secrets | From Partners dashboard |
| `SHOPIFY_APP_URL` | `fly.toml` / secrets | `https://amadaflow-loyalty.fly.dev` |
| `LOYALTY_ENGINE_SHARED_SECRET` | Fly secrets + Oxygen | `openssl rand -hex 32` |
| `DATABASE_URL` | Fly secrets | PostgreSQL (`postgresql://…`); set via `fly postgres attach` or `flyctl secrets set` |
| `SENTRY_DSN` | Fly secrets | Optional — error monitoring |

Storefront also needs `LOYALTY_ENGINE_URL` and `LOYALTY_ENGINE_SHARED_SECRET` in Oxygen environment variables.

---

## App Store submission checklist

| Item | Status |
|------|--------|
| Core features | Complete |
| Auth hardening | Complete |
| Idempotency | Complete |
| Refund rollback | Complete |
| GDPR handlers | Complete (handlers deployed; URLs need Partner Dashboard config) |
| Unit tests | Complete (42 tests) |
| Health endpoint | Complete |
| Sentry hooks | Complete |
| `shopify app deploy` | Pending |
| `flyctl deploy` | Pending |
| GDPR URLs in Partner Dashboard | Pending |
| Privacy policy URL | Pending |
| App listing + screenshots | Pending |
| Billing API | Complete — Managed Pricing + soft gate (Free: 3 tiers/3 rules, Pro: unlimited). Partner Dashboard plans + `SHOPIFY_APP_HANDLE` still need to be set. |

---

## Open follow-ups (do NOT do unless asked)

1. `app.reward-programs.tsx` currently re-exports `app._index.tsx`. Intended split: move all editors to reward-programs, leave home as pure dashboard.
2. Free-shipping redemption needs the `cart.delivery-options.discounts.generate.run` target in the function extension toml and a separate handler.
3. Function extension test fixtures in `extensions/loyalty-discount/tests/fixtures/` are stale relative to the current GraphQL input query. Regenerate with `shopify app function fixture`.
4. Billing API design is a separate session — required before App Store submission if the app charges merchants.
