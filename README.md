# Loyalty Engine

LoyaltyFlow: a private Shopify app that runs the loyalty program for the Amada Flow store. It is not on the App Store (Custom distribution, one store only).

- Live store: `76352b-84.myshopify.com`. Test store: `vic-test-rczyeeqw`.
- App config: `shopify.app.loyaltyflow.toml`.
- Stack: React Router 7, Polaris web components, Prisma, Postgres.
- The storefront is a separate Hydrogen repo (`amadaflow.com`, on Shopify Oxygen). It calls this engine over HTTP.

## What it does

- Earns points on paid orders, and takes back per-$ order points on refunds.
- Tiers, with a built-in automatic discount per tier, limited to a customer segment.
- Redeeming points creates a single-use discount code for one customer.
- Referrals: both people get points when the new customer's first order is paid.
- Admin pages: program editor, customers list, customer page (history and manual adjust), settings.
- GDPR webhooks (data request, customer redact, shop redact).
- `extensions/loyalty-checkout`: a checkout UI extension that shows a "you can earn points" note at checkout and on the thank-you page. It reads the program from an app metafield and makes no network calls.

There is no Shopify Function and no billing.

## Structure

```
app/routes/      admin pages, webhooks, /api/* for the storefront, /health
app/loyalty/     server logic (*.server.ts)
src/domain/      pure logic: points, tiers, referrals
src/webhooks/    webhook payload helpers
src/__tests__/   Vitest tests
prisma/          schema and migrations
extensions/loyalty-checkout/
docs/            deploy guide, specs and plans (docs/superpowers/)
```

## Commands

```bash
npm run dev         # local dev through the Shopify CLI
npx vitest run      # tests
npm run typecheck
npm run lint
npm run build
```

## Deploy

Everything runs on Google Cloud (project `loyalty-engine-494212`, `asia-southeast1`): Cloud Run service `amadaflow-loyalty`, Cloud SQL Postgres, Secret Manager.

```bash
gcloud run deploy amadaflow-loyalty --source . --project loyalty-engine-494212 --region asia-southeast1
```

Migrations run when the container starts. Details are in the "Current production setup" section of [docs/deploy-cloud-run.md](docs/deploy-cloud-run.md). Health check: `GET /health`.

## Environment variables

`.env.example` lists them.

| Name | Use |
|---|---|
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | Shopify app credentials |
| `SHOPIFY_APP_URL` | public URL of the service |
| `SCOPES` | must match `shopify.app.loyaltyflow.toml` |
| `DATABASE_URL` | Postgres |
| `LOYALTY_ENGINE_SHARED_SECRET` | storefront-to-engine secret (same value in the storefront) |
| `LOYALTY_CUSTOMER_TOKEN_SECRET` | signs per-customer tokens (same value in the storefront) |
| `SHOP_CUSTOM_DOMAIN` | optional, local dev only |

In production the secrets are in Secret Manager.

See [HANDOFF.md](HANDOFF.md) for how it fits together and what is still open.
