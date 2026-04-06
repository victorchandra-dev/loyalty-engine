# Loyalty Engine App

This workspace contains the Shopify app that powers the long-term loyalty engine for the storefront.

## Responsibilities

- normalize merchant-managed loyalty configuration from Shopify admin
- sync derived shop and customer loyalty state
- own the automatic discount function used at checkout
- provide an embedded admin UI for diagnostics and manual sync actions

## Current Source Of Truth

The current merchant-managed source of truth lives in Shopify admin:

- `loyalty_reward_tier` merchant-owned metaobjects

Supported tier fields today:

- `label`
- `minimum_spend`
- `discount_percentage`

The app also supports an optional future benefit layer:

- `loyalty_reward_benefit`

## Structure

- `app/`: embedded Shopify app UI, authentication, and webhook routes
- `src/`: shared domain model and Shopify-specific sync helpers
- `extensions/loyalty-discount`: Shopify discount function
- `shopify.app.toml`: linked Shopify app configuration

## Local Development

Install dependencies:

```bash
npm install
```

Run the embedded app locally:

```bash
npm run dev
```

Local preview stores app sessions in a SQLite file at `shopify-app.session.sqlite`.
This keeps the dev runtime self-contained and avoids Prisma migrations during Shopify CLI previews.
The app also patches the local `shopify_sessions` table to include refresh token columns required by the current Shopify session model.

Useful commands:

```bash
npm run typecheck
npm run build
npm run deploy
```

## Current Admin UI

The app home page shows:

- resolved loyalty tiers
- resolved benefits
- configuration issues
- a manual "Sync program snapshot" action

## Derived App-Owned Metafields

The app declares and syncs:

### Shop metafields

- `loyalty_program_snapshot`
- `loyalty_program_issues`
- `loyalty_program_synced_at`
- `loyalty_discount_id`

### Customer metafields

- `loyalty_state`
- `loyalty_points_balance`

## Current Checkout Flow

The current discount function reads:

- the normalized shop-level loyalty program snapshot
- the current customer spend and order metrics from function input

It then resolves the active loyalty order discount for checkout.
