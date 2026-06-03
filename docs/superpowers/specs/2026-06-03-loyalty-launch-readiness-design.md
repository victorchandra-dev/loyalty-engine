# LoyaltyFlow — Launch-Readiness Design

**Date:** 2026-06-03
**Author:** brainstorming session (Claude + Dmitriy)
**Status:** Approved design — ready for implementation plan

## Context

LoyaltyFlow is a Shopify loyalty app (React Router v7 + `@shopify/shopify-app-react-router`,
deployed on Fly.io, Postgres). It is a demo vehicle for Amada Flow and targets the Shopify
App Store. Most code is already implemented, type-checked, and the engine is **already live**
on Fly (`https://amadaflow-loyalty.fly.dev/health` → `200 {"ok":true,"db":"up"}`,
deployed 2026-06-02, region `sin`, 512 MB / 1 shared CPU, 2 machines).

This effort is therefore **deploy + configure + verify**, not new feature building.

### Decisions (from brainstorming)

- **Scale this week:** Demo only (~1–5 stores). → Light Fly headroom check, *no* formal load test.
- **Pricing:** Shopify Managed Pricing — **Free** ($0) + **Pro** ($9.99/mo, 14-day trial),
  matching the coded soft-gate (Free: 3 tiers / 3 rules; Pro: unlimited).
- **Partners end-state:** **Submission-ready, not submitted.** Everything deployed & compliant
  so submit is possible; we do not click submit this week.

### Goals (this week)

1. Admin UI and Pricing page up and running.
2. Make sure Fly.io can handle the (demo-scale) traffic.
3. Deploy GDPR / customer-data compliance so the app can be submitted to Shopify Partners.
4. Webhooks at least triggerable.

## Work Split

- **Claude can do:** code/config edits, `shopify app deploy`, `flyctl deploy`, automated
  verification (curl / health / webhook triggers), reading deployed state, drafting docs.
- **User-only (dashboard / secrets / content):** create Managed Pricing plans, set Fly secrets,
  confirm the app handle, approve/host the privacy-policy content.

## Design by Goal

### Goal 1 — Admin UI + Pricing page

**Pricing (fixes the `charges/<handle>/pricing_plans` 404):**

1. *User*: Partner Dashboard → LoyaltyFlow → Managed Pricing → create **Free** ($0) and
   **Pro** ($9.99/mo, 14-day trial).
2. *User/Claude*: Confirm the app's real handle matches `loyaltyflow`; if not,
   `flyctl secrets set SHOPIFY_APP_HANDLE=<handle>` (code defaults to `loyaltyflow` in
   `app/loyalty/billing.server.ts` → `managedPricingUrl`).
3. *Claude*: Verify the `/app` upgrade link resolves to a live (non-404) pricing page, and
   that `getActivePlan()` resolves Free → soft-gate (3 tiers/3 rules) and Pro → unlimited.

**Admin UI:**

4. *Claude*: Smoke-test each admin route against the dev store — `/app` (dashboard + on/off
   toggle), `/app/customers`, `/app/reward-programs`, `/app/settings` — confirm load, save,
   and soft-gate behaviour.

### Goal 2 — Fly.io capacity (demo-scale)

5. *Claude*: Verify config is sane for 1–5 stores: `min_machines_running=1`, auto start/stop,
   `/health` check (30s), 512 MB / 1 shared CPU. Confirm the stopped 2nd machine auto-starts.
6. *Claude*: Sanity-check Postgres connection handling (Prisma pool vs Fly PG) and that
   `/health` exercises the DB (it does — `db:up`).
7. *Claude*: Light headroom check only — a short concurrent-request burst against `/health`
   and `/api/public-loyalty-program`; confirm no memory pressure. **No formal load test.**

### Goal 3 — GDPR / customer-data compliance (submission-ready)

8. *Claude*: Confirm the three privacy handlers (`customers/data-request`, `customers/redact`,
   `shop/redact`) and `[webhooks.privacy_compliance]` URLs in `shopify.app.loyaltyflow.toml`
   are correct, then `shopify app deploy` (config-on-deploy is enabled) so they register.
9. *Claude*: Verify each privacy endpoint is reachable and HMAC-validates (reject unsigned,
   accept signed).
10. *Claude*: **Draft a privacy policy** document (content + a hostable page/URL plan) — this
    is the one content gap blocking "submission-ready." User reviews/approves and provides the
    final hosted URL.

### Goal 4 — Webhooks triggerable

11. *Claude*: After deploy, confirm all subscriptions registered (`orders/paid`,
    `refunds/create`, `metaobjects/*`, `app/uninstalled`, `app/scopes_update`).
12. *Claude*: Trigger and observe at least `orders/paid` (points award + idempotency guard)
    and `refunds/create` (points debit) — via `shopify app webhook trigger` and/or a real
    test order; confirm handler logs + metafield writes.

## Verification Posture

Every goal ends with an explicit **pass/fail check** — a curl response, a log line, or a
metafield value. No "should work" claims; evidence before assertions.

## Out of Scope (parked follow-ups)

- **Reward-programs page split** (`app.reward-programs.tsx` currently re-exports
  `app._index.tsx`) — parked first, by decision.
- Free-shipping redemption target (`cart.delivery-options.discounts.generate.run`).
- Stale function-extension test fixtures.
- Actual Partners submission (listing copy, screenshots, clicking submit).
- Formal load testing (not warranted at demo scale).

## Success Criteria

- Pricing page loads (non-404) with Free + Pro plans; upgrade link works from `/app`.
- All four admin routes load and save against the dev store.
- Fly serves a demo-scale burst with headroom; 2nd machine auto-starts.
- `shopify app deploy` succeeds; all webhook + privacy subscriptions registered.
- Privacy endpoints HMAC-validate; `orders/paid` + `refunds/create` observably trigger.
- A reviewed privacy-policy draft exists with a hosting plan.
- Net result: the app *could* be submitted to Partners (we do not submit).
