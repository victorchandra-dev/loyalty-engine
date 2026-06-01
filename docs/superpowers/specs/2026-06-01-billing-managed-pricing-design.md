# Shopify Billing — Managed Pricing with Soft Feature Gate

**Date:** 2026-06-01
**Status:** Approved design (pending spec review)
**Goal:** Satisfy the App Store requirement that merchant charges go through Shopify
billing, and monetize the loyalty app with a Free + Pro plan model.

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Billing mechanism | **Managed Pricing** (plans defined in Partner Dashboard; Shopify hosts the pricing/upgrade/cancel UI) |
| Plan structure | **Free + Pro**, Pro has a **14-day trial** |
| Enforcement | **Soft gate** by feature limit (app stays usable on Free, capped) |
| Gated capabilities | **Reward tiers** and **earn rules** only |
| Not gated | Referral program, redemption types, customer-account UI |
| Free caps | **3 reward tiers, 3 earn rules** (matches the default seed) — Pro = unlimited |

### Why caps = 3, not 1

`initializeLoyaltyProgram` seeds fresh installs with **3 tiers** (`DEFAULT_TIER_SEEDS`:
5%/10%/15%) and **3 earn rules** (`DEFAULT_EARN_RULE_SEEDS`: signup/order/referral).
A cap of 1 would put every new merchant immediately over the limit and block all
saves. Setting the free cap to the seeded starter-set size (3) keeps onboarding
intact; the upsell is "you've used all 3 free tiers — upgrade to add more."

## Architecture

Three new units plus targeted edits to one route. The pure gate logic is isolated
from Shopify so it can be unit-tested without a live Admin API.

```
src/domain/billing.ts          ← pure: caps + exceeds* predicates (unit-tested)
app/loyalty/billing.server.ts  ← thin: query active subscription, build pricing URL
app/routes/app._index.tsx      ← loader exposes plan; action enforces caps; UI shows CTA
```

### Unit 1 — `src/domain/billing.ts` (pure, no Shopify deps)

```ts
export const FREE_TIER_MAX_TIERS = 3;
export const FREE_TIER_MAX_EARN_RULES = 3;

// True when saving `count` entries is not allowed on the current plan.
export function exceedsTierLimit(count: number, isPro: boolean): boolean;
export function exceedsEarnRuleLimit(count: number, isPro: boolean): boolean;
```

- `isPro === true` → always `false` (unlimited).
- `isPro === false` → `count > FREE_TIER_MAX_*`.
- **What it does:** decides whether a desired entry count is allowed for a plan.
- **How to use it:** call from the route action with the incoming entry count.
- **Depends on:** nothing.

### Unit 2 — `app/loyalty/billing.server.ts` (thin Shopify adapter)

```ts
export type ActivePlan = { isPro: boolean; planName: string | null };
export async function getActivePlan(admin: AdminApiContext): Promise<ActivePlan>;
export function managedPricingUrl(shopDomain: string): string;
```

- `getActivePlan` runs:
  ```graphql
  query { currentAppInstallation { activeSubscriptions { name status } } }
  ```
  `isPro = activeSubscriptions.some(s => s.status === 'ACTIVE')`. The Managed
  Pricing 14-day trial reports `status: ACTIVE`, so **trial users are `isPro`
  automatically** — no separate trial handling. `planName` is the first active
  subscription's `name` (for display).
- `managedPricingUrl(shop)` returns the Shopify-hosted plan page:
  `https://admin.shopify.com/store/<store-handle>/charges/<APP_HANDLE>/pricing_plans`
  where `<store-handle>` is `shop` minus `.myshopify.com`, and `APP_HANDLE` is a
  module constant matching the app handle in the Partner Dashboard.
  *(Implementation note: verify the embedded-app navigation path during testing;
  if the absolute admin URL does not break out of the iframe cleanly, fall back to
  the App Bridge `shopify://admin/charges/<handle>/pricing_plans` form.)*
- **Depends on:** `AdminApiContext`, `getActivePlan`'s GraphQL; the URL builder is pure.

### Unit 3 — enforcement + UI in `app/routes/app._index.tsx`

**Loader:** after `authenticate.admin`, call `getActivePlan(admin)` and include
`isPro`, `planName`, and `pricingUrl` in the returned data.

**Action:** resolve `isPro` once (via `getActivePlan`). In the `saveTier` and
`saveEarnRules` cases, after parsing the incoming entries, check the matching
`exceeds*Limit(count, isPro)`. If exceeded, return
`{ ok: false, upgradeRequired: true, message }` **without** calling the save
helper. All other intents are unchanged.

**Why the action, not the save functions:** `seedDefaultEarnRulesAndRedemptions`
calls `saveEarnRuleConfiguration`/`applyEarnRuleEntries` internally during init.
Gating must never block seeding, so the check lives in the user-initiated action
path only.

**UI:** a plan badge (`Free` / `Pro`), and when a free merchant is at the cap, the
"Add tier"/"Add earn rule" affordance is disabled with an inline **Upgrade to Pro**
link to `pricingUrl`, opened in the top frame via App Bridge. The save action's
`upgradeRequired` response surfaces the same CTA if a capped save is attempted.

## Data flow

```
Merchant edits tiers ─▶ app._index action
                         ├─ getActivePlan(admin) ─▶ Admin GraphQL activeSubscriptions
                         ├─ exceedsTierLimit(count, isPro)?
                         │     ├─ yes ─▶ return {upgradeRequired:true}  (no write)
                         │     └─ no  ─▶ saveTierConfiguration(...)      (existing path)
                         └─ render result / upgrade CTA
```

## Error handling

- `getActivePlan` GraphQL failure: **fail open to Free** (treat as `isPro=false`)
  and log. Rationale: a billing-check outage must not block a paying merchant from
  *using* already-saved config (reads are ungated) nor silently grant Pro. The only
  effect of fail-open is a paying merchant briefly cannot add a *4th+* tier during
  an outage — acceptable and safe. Never fail-closed in a way that hides their data.
- Capped save attempt: structured `upgradeRequired` result, HTTP 200, no metaobject
  writes. The UI shows the upgrade CTA; nothing is partially saved.

## Testing

- **Unit (`src/__tests__/domain/billing.test.ts`)** — pure predicates:
  - Pro is always allowed (counts of 1, 3, 4, 100 → `false`).
  - Free allowed at/below cap (1, 3 → `false`), blocked above (4 → `true`), both
    tiers and earn rules.
  - Boundary at exactly the cap (3 → allowed).
- **Manual / review-store** — verify on a development store with the plans live:
  - No active subscription → app usable, capped at 3, upgrade CTA visible.
  - Subscribe to Pro (trial) → `isPro` true, caps lifted, can add 4th tier/rule.
  - Cancel → reverts to Free behavior.

## Partner Dashboard setup (manual, by app owner — documented in STORE_LISTING.md)

1. Partners → Apps → [app] → **Pricing** → enable **Managed Pricing**.
2. Create **Free** plan (no charge).
3. Create **Pro** plan: recurring price, **14-day trial**.
4. Confirm `APP_HANDLE` in `billing.server.ts` matches the app handle.
5. After `shopify app deploy`, verify the pricing page renders and a test
   subscription flips `isPro` in the admin UI.

## Out of scope (YAGNI)

Usage-based records, multiple Pro tiers, annual billing, proration — Managed Pricing
owns all upgrade/downgrade/cancel/proration UX. Revisit only if pricing strategy
changes.

## Files touched

| File | Change |
|------|--------|
| `src/domain/billing.ts` | **new** — caps + predicates |
| `src/__tests__/domain/billing.test.ts` | **new** — unit tests |
| `app/loyalty/billing.server.ts` | **new** — `getActivePlan`, `managedPricingUrl` |
| `app/routes/app._index.tsx` | loader exposes plan; action enforces caps; UI CTA |
| `STORE_LISTING.md` / `HANDOFF.md` | check off Billing; add Managed Pricing setup steps |
