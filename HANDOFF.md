# Loyalty engine + Hydrogen wiring — handover for Claude Code

## TL;DR what's open

The user (Dmitriy) made a series of UI changes to the engine admin home page over multiple sessions. Multiple deploys went through. After the most recent layout changes (full-width home, horizontal hero split, on/off toggle inline in banner), the changes are NOT visible in the embedded admin. Past pattern: source has the changes but the deploy is using older code, usually because the working tree is uncommitted at deploy time.

Your first job is to verify whether the deployed version reflects the latest source. Then, if the deploy is stale, make sure all changes are committed and redeploy. If the deploy is current and the layout still looks wrong, debug from devtools/admin-iframe.

---

## Repo layout

- Storefront: Hydrogen on Shopify Oxygen. Lives at the repo root. Branch: `feat/loyalty-engine-metafield-read`.
- Engine: Embedded Shopify app at `apps/loyalty-engine/`. React Router 7 + Polaris web components (`<s-page>`, `<s-section>`, `<s-banner>`, etc.). Deploys to Fly.io (see `apps/loyalty-engine/fly.toml`). Function extension at `apps/loyalty-engine/extensions/loyalty-discount/` deploys via `shopify app deploy`.

---

## Architecture you should know

The storefront and engine talk via a customer-authenticated proxy + shared secret:

1. Customer clicks Redeem on the Hydrogen rewards page.
2. Hydrogen route `app/routes/api.loyalty.redeem.tsx`:
   - Verifies `context.customerAccount.isLoggedIn()`.
   - Queries `CustomerIdQuery` to get the customer's admin GID server-side (never trusts client-supplied IDs).
   - POSTs to `${env.LOYALTY_ENGINE_URL}/api/redeem` with headers `X-Loyalty-Engine-Secret` (matches engine's `LOYALTY_ENGINE_SHARED_SECRET` env) and `X-Shopify-Shop-Domain`.
3. Engine route `apps/loyalty-engine/app/routes/api.redeem.tsx`:
   - Constant-time compares the shared secret.
   - Builds an Admin client via `unauthenticated.admin(shopDomain)`.
   - Calls `applyRedemptionForCustomer` in `app/loyalty/customer-state.server.ts` which validates redemption + balance, debits, and writes the `loyalty_active_redemption` JSON metafield.
4. Discount function reads the customer's `loyalty_active_redemption` metafield at every cart eval and emits a second discount candidate alongside the tier discount.
5. Storefront also reads three customer metafields via Customer Account API (`loyalty_state`, `loyalty_points_balance`, `loyalty_active_redemption`) — these need `customer_account = "read"` access in `shopify.app.toml`. Already declared in toml; gets applied on `shopify app deploy`.

Points awarding: `webhooks.orders-paid.tsx` calls `fetchCustomerPointsState` then `projectPointsAwardForOrder` (pure fn in `src/domain/program.ts:computeOrderPoints` + `getOneShotEarnPoints`), then `syncCustomerLoyaltyState` writes both `loyalty_points_balance` and `loyalty_state` (now with `awardedRules`).

Image generation tier-locking: `app/routes/api.ai-preview.tsx` uses `app/lib/image-gen-quota.server.ts` to read tier from `loyalty_state`, look up monthly quota (ladder: 1 / 3 / 5 / 15 / 30 by tier rank), and either reject 429 or generate + persist usage via Admin API.

On/off toggle: shop metafield `$app.loyalty_program_enabled`. Read in `app/loyalty/settings.server.ts`. Discount function short-circuits to empty when `snapshot.enabled === false`. Inline buttons on the home dashboard banner + dedicated controls on Settings page — both call the same `setProgramEnabled` helper.

---

## Current source-of-truth file map

Storefront (Hydrogen):
- `app/components/LoyaltyFloatingWidget.tsx` — bottom-sheet rewards launcher with REDEEM buttons wired to `useFetcher`.
- `app/routes/account.loyalty.tsx` — full rewards page with banner + redemption catalog.
- `app/routes/api.loyalty.redeem.tsx` — proxy to engine.
- `app/routes/api.ai-preview.tsx` — image gen, tier-locked.
- `app/lib/loyalty.ts` + `app/lib/loyalty.server.ts` — types, default earn rules + redemptions, parsing.
- `app/lib/image-gen-quota.server.ts` — quota math + Admin API persist.
- `app/graphql/customer-account/CustomerLoyaltyStateQuery.ts` — now reads 3 metafields.
- `app/graphql/customer-account/CustomerIdQuery.ts` — minimal id query for redeem proxy.
- `app/graphql/customer-account/CustomerImageGenContextQuery.ts` — for image gen quota lookup.
- `app/graphql/storefront/LoyaltyProgramQuery.ts` — tiers + earn rules + redemptions.
- `env.d.ts` — adds `LOYALTY_ENGINE_URL`, `LOYALTY_ENGINE_SHARED_SECRET`.
- `eslint.config.js` — root flat config now ignores `apps/**`, `newhydrogen/**`, `shopify-email-templates/**`.

Engine:
- `apps/loyalty-engine/shopify.app.toml` — webhook filter expanded, new metafields with `customer_account = "read"`, new shop metafield `loyalty_program_enabled`.
- `apps/loyalty-engine/app/routes/app.tsx` — top nav (Home, Customers, Reward programs, Settings).
- `apps/loyalty-engine/app/routes/app._index.tsx` — home dashboard. **Recently changed**: removed `OwnershipAside`, added inline toggle, restructured hero.
- `apps/loyalty-engine/app/routes/app.settings.tsx` — Settings page with master Active/Paused toggle.
- `apps/loyalty-engine/app/routes/app.customers.tsx` — paginated customers table.
- `apps/loyalty-engine/app/routes/app.reward-programs.tsx` — currently re-exports `app._index.tsx`.
- `apps/loyalty-engine/app/routes/api.redeem.tsx` — admin auth + shared-secret auth.
- `apps/loyalty-engine/app/routes/webhooks.orders-paid.tsx` — projects + writes points.
- `apps/loyalty-engine/app/components/loyalty-admin-ui.tsx` — `ProgramHero`, `TierEditor`, `EarnRuleEditor`, `RedemptionEditor`, `EarnRulesAndRedemptions`, `OwnershipAside`. **Recently changed**: hero JSX wraps pills in `.heroPills`; tier card uses thin `.tierSummary` line instead of two preview tiles.
- `apps/loyalty-engine/app/components/loyalty-admin-ui.module.css` — **most recently changed file**: hero now `grid-template-areas` with `copy/metrics/pills` regions, side-by-side at desktop. Tier cards compact (~50% shorter).
- `apps/loyalty-engine/app/loyalty/admin.server.ts` — tier save flow + customer-points-state round-trip on backfill.
- `apps/loyalty-engine/app/loyalty/customer-state.server.ts` — `fetchCustomerPointsState`, `projectPointsAwardForOrder`, `applyRedemptionForCustomer`, `clearRedemptionForCustomer`.
- `apps/loyalty-engine/app/loyalty/program.server.ts` — fetches all 4 metaobject types, snapshot now includes `enabled` flag.
- `apps/loyalty-engine/app/loyalty/settings.server.ts` — read/write program-enabled flag.
- `apps/loyalty-engine/app/loyalty/earn-rules-redemptions-admin.server.ts` — saveEarnRuleConfiguration + saveRedemptionConfiguration.
- `apps/loyalty-engine/app/loyalty/constants.ts` — metaobject types, action codes, reward types, key constants.
- `apps/loyalty-engine/src/domain/program.ts` — extended with EarnRule + Redemption configs, `computeOrderPoints`, `getOneShotEarnPoints`.
- `apps/loyalty-engine/src/domain/customer-state.ts` — adds `awardedRules`.
- `apps/loyalty-engine/src/webhooks/orders-paid.ts` — adds `getOrdersPaidOrderAmount` + threads `awardedRules`.
- `apps/loyalty-engine/src/webhooks/metaobjects.ts` — sync plan accepts new entries.
- `apps/loyalty-engine/src/integrations/shopify/admin-operations.ts` — `LOYALTY_PROGRAM_ADMIN_QUERY` fetches earn rules + redemptions.
- `apps/loyalty-engine/extensions/loyalty-discount/src/cart_lines_discounts_generate_run.graphql` — reads `customer.activeRedemption` and `cart.cost.subtotalAmount`.
- `apps/loyalty-engine/extensions/loyalty-discount/src/cart_lines_discounts_generate_run.ts` — emits two `orderDiscountsAdd` operations (tier + redemption); short-circuits if `snapshot.enabled === false`.

---

## Diagnostic ladder — RUN THESE IN ORDER

Stop at the first FAIL and report findings.

### 1. Source on disk has the latest layout changes

```bash
cd /Users/naspadmini/Documents/GitHub/amadaflow.com/apps/loyalty-engine

echo "Hero grid-template-areas:"; grep -c "grid-template-areas" app/components/loyalty-admin-ui.module.css
echo "Tier summary class:";       grep -c "\.tierSummary" app/components/loyalty-admin-ui.module.css
echo "Hero pills wrapper in JSX:"; grep -c "className={styles.heroPills}" app/components/loyalty-admin-ui.tsx
echo "OwnershipAside removed from home:"; grep -c "OwnershipAside" app/routes/app._index.tsx
echo "Toggle in banner:"; grep -c "toggleProgram" app/routes/app._index.tsx
```

Expected: first 3 are >= 1. Fourth is 0 (the import was removed). Fifth is >= 2 (handler + button).

### 2. Working tree is fully committed

```bash
cd /Users/naspadmini/Documents/GitHub/amadaflow.com
git status --porcelain
git log --oneline -5
```

PASS = empty `git status` output AND latest commit message references "loyalty" or "ui" or similar recent work.

FAIL (highly likely) = `git status` shows modified or untracked files including the engine work. Almost every problem we have hit on this branch traces back to "deployed without committing first." If FAIL, do this:

```bash
# tsbuildinfo is a local build artifact, never commit
git checkout -- tsconfig.tsbuildinfo
echo "tsconfig.tsbuildinfo" >> .gitignore

git add -A
git commit -m "ui(loyalty): full-width home + horizontal hero + compact tiers"
```

### 3. Engine deploy used the right source

```bash
cd /Users/naspadmini/Documents/GitHub/amadaflow.com/apps/loyalty-engine
shopify app versions list 2>&1 | head -20
```

If "Command not found" or auth error: `shopify auth login`, retry. If list shows a recent version after the most recent commit hash, deploy is current. If the latest version's timestamp is older than the latest commit, redeploy:

```bash
# from apps/loyalty-engine/
cd extensions/loyalty-discount && npm run typegen && cd ..
shopify app deploy
```

Note: `npm run typegen` lives in the EXTENSION's package.json, not the engine root.

### 4. `node_modules` health check

The engine and its extension both need their own working `node_modules`. Past failure: "shamefully-hoist" pnpm config + `npm install` left a hybrid state with missing files. If you see "Cannot find module" errors during build:

```bash
cd /Users/naspadmini/Documents/GitHub/amadaflow.com/apps/loyalty-engine
ls node_modules/vite/package.json node_modules/eslint/package.json node_modules/@shopify/polaris-types/package.json
```

If any are missing, blow away and reinstall. Pick ONE manager and use it for both engine and extension:

```bash
# from apps/loyalty-engine/
rm -rf node_modules package-lock.json
npm install --no-audit --no-fund

cd extensions/loyalty-discount
rm -rf node_modules
npm install --no-audit --no-fund
```

If a `.npmrc` with `shamefully-hoist=true` exists in the engine, that's a leftover from pnpm — either commit to pnpm everywhere or delete that line.

### 5. Embedded admin cache

If steps 1–4 PASS but the admin still looks wrong, it's the iframe cache. In order:

1. Hard reload (Cmd+Shift+R) twice.
2. Close the admin tab entirely, re-open the app from Shopify sidebar.
3. Open in incognito / different browser.
4. Open browser devtools → Sources → Cmd+P → search for "App status: Active". If present in the bundle, the new code is shipped — there's a render-time issue. If absent, the deploy is serving stale assets.

---

## Env vars needed before redemption can work end-to-end

Storefront (Oxygen → Hydrogen storefront → Environment variables):
- `LOYALTY_ENGINE_URL` — public HTTPS URL of the engine, e.g. `https://amadaflow-loyalty.fly.dev`
- `LOYALTY_ENGINE_SHARED_SECRET` — same value as on the engine
- `PUBLIC_STORE_DOMAIN` — `*.myshopify.com` domain (already used by Hydrogen)
- `SHOPIFY_ADMIN_API_TOKEN` — already used by storefront for image-gen quota persist

Engine (Fly.io secrets):
- `LOYALTY_ENGINE_SHARED_SECRET` — same value as storefront. Generate with `openssl rand -hex 32`.

Set on Fly: `cd apps/loyalty-engine && fly secrets set LOYALTY_ENGINE_SHARED_SECRET=<value>`.

---

## Pre-deploy commands (the correct order)

```bash
# from repo root
git status                                # confirm clean

# engine
cd apps/loyalty-engine

# only if node_modules is broken
rm -rf node_modules && npm install --no-audit --no-fund

# function extension typegen + smoke build
cd extensions/loyalty-discount
rm -rf node_modules
npm install --no-audit --no-fund
npm run typegen           # writes generated/api.ts from updated GraphQL
npm run build             # produces dist/function.wasm
cd ..

# deploy
shopify app deploy        # bundles wasm + admin app, creates new version

# storefront pushes auto-deploy to Oxygen via GitHub Actions on push
cd ../..
git push origin feat/loyalty-engine-metafield-read
```

---

## What will likely show up in `git status`

If the user has committed nothing since the last successful deploy, expect roughly:
- ~30 modified files spanning `app/`, `apps/loyalty-engine/`, `env.d.ts`, `eslint.config.js`, `.env.example`
- ~12 new untracked files including 3 storefront GraphQL files, `app/lib/image-gen-quota.server.ts`, `app/routes/api.loyalty.redeem.tsx`, and several engine routes/server files
- 1 file (`tsconfig.tsbuildinfo`) that should NEVER be committed — restore it before adding all

---

## Open follow-ups (do NOT do unless asked)

1. The `app.reward-programs.tsx` route currently re-exports `app._index.tsx`. The intended split is to move all editors out of home into reward-programs, leaving home as a pure dashboard. User said incremental version is OK for now.
2. App proxy route on engine for storefront-driven redemption (currently uses shared-secret HTTPS). App proxy is more idiomatic but Oxygen-on-Hydrogen edge handling makes it unreliable; shared-secret is the correct call until that lands cleanly.
3. The `loyalty-discount` function extension test fixtures in `extensions/loyalty-discount/tests/fixtures/` are stale relative to the current GraphQL input query. Tests fail with EPERM in some sandboxes for unrelated reasons. Regenerate with `shopify app function fixture` if the user wants clean test runs.
4. Free-shipping redemption needs the `cart.delivery-options.discounts.generate.run` target registered in the function `shopify.extension.toml` and a separate handler — current function only handles `fixed_discount` and `percent_discount`.
5. `customer_account = "read"` access is now declared on `loyalty_points_balance` and `loyalty_active_redemption` metafields in the toml. After the next `shopify app deploy`, Shopify will run `metafieldDefinitionUpdate` on the existing definitions to apply the new access. Verify by re-querying via Customer Account API after deploy.

---

## How to ask the user

If you need clarification, the user prefers concrete options over open questions. They moved fast through this work and don't want to re-explain context. Examples of good questions:

- "After running the diagnostic ladder, X failed with output Y. Recommended fix: Z. Proceed?"
- "Shopify CLI not authenticated for engine app. Run `shopify auth login` and retry, or paste error?"

Bad questions: "What do you want to do?" — they've already said they want the layout to update. Just figure out why it isn't and fix it.

---

## Verification command (run before reporting back)

```bash
cd /Users/naspadmini/Documents/GitHub/amadaflow.com

# Storefront tsc — should be 39 pre-existing errors, ZERO in any of these files
npx tsc --noEmit 2>&1 | grep -E "^app/(lib/loyalty|lib/image-gen-quota|graphql/storefront/LoyaltyProgramQuery|graphql/customer-account/Customer|components/Loyalty|routes/account.loyalty|routes/api.loyalty|routes/api.ai-preview)"
# Expect: empty output (zero errors in touched files)

# Storefront lint — should be clean on all touched files
npx eslint \
  app/lib/loyalty.ts app/lib/loyalty.server.ts app/lib/image-gen-quota.server.ts \
  app/components/LoyaltyFloatingWidget.tsx \
  app/routes/account.loyalty.tsx app/routes/api.loyalty.redeem.tsx app/routes/api.ai-preview.tsx \
  app/graphql/customer-account/CustomerIdQuery.ts \
  app/graphql/customer-account/CustomerImageGenContextQuery.ts \
  app/graphql/customer-account/CustomerLoyaltyStateQuery.ts
# Expect: empty output (no errors or warnings)
```

If either of those produces unexpected output, something the previous session shipped has regressed and you need to fix it before doing anything else.
