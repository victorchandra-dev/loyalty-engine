# Loyalty Engine

Shopify embedded app powering the Amada Flow loyalty program. React Router 7 + Polaris web components, deployed to Fly.io (`amadaflow-loyalty`).

## Capabilities

- **Earn rules** — flat or per-currency-unit points on orders; one-shot bonuses for signup, referral, birthday
- **Tiered membership** — configurable tiers by lifetime spend, order count, or points balance
- **Redemptions** — discount-code rewards debited against points balance
- **Referral tracking** — attributes referrer on first order; reconciliation UI for partial failures
- **Refund rollback** — automatically debits points when an order is refunded
- **Webhook idempotency** — `lastOrderId` guard prevents double-awarding on Shopify retries
- **Discount function** — Shopify function extension (`extensions/loyalty-discount`) emits tier + redemption discounts at checkout; short-circuits when program is disabled
- **Image-gen tier lock** — monthly quota ladder enforced per tier
- **On/off toggle** — program-enabled flag controls discount function and admin UI state
- **GDPR compliance** — customer data request, customer redact, and shop redact handlers

## Structure

```
app/
  routes/          # Embedded admin UI + webhook + API handlers
  loyalty/         # Server-side business logic (*.server.ts)
  components/      # Admin UI components
src/
  domain/          # Pure domain logic (program, customer-state)
  webhooks/        # Webhook payload parsers and helpers
  __tests__/       # Vitest unit tests (42 tests)
extensions/
  loyalty-discount/  # Shopify discount function (Wasm)
```

## Commands

```bash
npm run dev        # Local dev with Shopify CLI tunnel
npm run build      # Production build
npm run typecheck  # Type-check (react-router typegen + tsc)
npx vitest run     # Run unit tests (src/__tests__/)
npm run deploy     # shopify app deploy (registers webhooks + uploads function)
```

## Deploy

```bash
# 1. Deploy app + function extension to Shopify
shopify app deploy

# 2. Deploy server to Fly.io
flyctl deploy
```

Health check: `GET /health` — returns `{ok: true, db: "up"}` or 503.

## Environment variables

See `.env.example` for all required vars. Production secrets are set via Fly.io:

```bash
flyctl secrets set LOYALTY_ENGINE_SHARED_SECRET=<value>
flyctl secrets set SENTRY_DSN=<value>   # optional
```

## GDPR webhooks

The three GDPR handlers are deployed at:
- `POST /webhooks/customers/data-request`
- `POST /webhooks/customers/redact`
- `POST /webhooks/shop/redact`

These must be registered manually in the Shopify Partner Dashboard → App → Configuration → Privacy webhooks (they cannot be registered via `shopify.app.toml`).

## App Store submission status

| Item | Status |
|------|--------|
| Core features | Complete |
| Auth (shared-secret + admin JWT) | Complete |
| Webhook idempotency | Complete |
| Refund rollback | Complete |
| GDPR handlers | Complete |
| Unit tests (42) | Complete |
| Health endpoint | Complete |
| Sentry instrumentation | Complete |
| GDPR URLs in Partner Dashboard | Pending |
| Privacy policy URL | Pending |
| App listing + screenshots | Pending |
| Billing API | Pending (required if paid) |
