# Billing — Managed Pricing with Soft Feature Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Shopify Managed Pricing (Free + Pro/14-day-trial) with a soft feature gate that caps Free merchants at 3 reward tiers and 3 earn rules, satisfying the App Store billing requirement.

**Architecture:** Pure gate predicates in `src/domain/billing.ts` (unit-tested, no Shopify deps). A thin adapter `app/loyalty/billing.server.ts` queries the active subscription via Admin GraphQL and builds the managed-pricing URL. The `app/routes/app._index.tsx` loader exposes the plan; its action enforces the caps before saving; its UI shows a plan badge + Upgrade CTA. Plans themselves are defined in the Partner Dashboard, not in code.

**Tech Stack:** TypeScript, React Router 7, `@shopify/shopify-app-react-router`, Vitest (node env), Shopify Admin GraphQL.

**Spec:** `docs/superpowers/specs/2026-06-01-billing-managed-pricing-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/domain/billing.ts` | **new** — pure caps + `exceeds*Limit` predicates |
| `src/__tests__/domain/billing.test.ts` | **new** — unit tests for predicates |
| `app/loyalty/billing.server.ts` | **new** — `getActivePlan` (GraphQL, fail-open), `managedPricingUrl` |
| `src/__tests__/loyalty/billing.server.test.ts` | **new** — unit tests for adapter via fake admin |
| `app/routes/app._index.tsx` | modify — loader exposes plan; action enforces caps; UI CTA |
| `.env.example` | modify — document `SHOPIFY_APP_HANDLE` |
| `STORE_LISTING.md`, `HANDOFF.md` | modify — check off Billing; add Managed Pricing setup steps |

---

## Task 1: Pure gate predicates

**Files:**
- Create: `src/domain/billing.ts`
- Test: `src/__tests__/domain/billing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/domain/billing.test.ts`:

```ts
import {describe, it, expect} from 'vitest';
import {
  FREE_TIER_MAX_TIERS,
  FREE_TIER_MAX_EARN_RULES,
  exceedsTierLimit,
  exceedsEarnRuleLimit,
} from '../../domain/billing.js';

describe('exceedsTierLimit', () => {
  it('never limits Pro merchants', () => {
    expect(exceedsTierLimit(1, true)).toBe(false);
    expect(exceedsTierLimit(100, true)).toBe(false);
  });

  it('allows Free merchants up to the cap', () => {
    expect(exceedsTierLimit(1, false)).toBe(false);
    expect(exceedsTierLimit(FREE_TIER_MAX_TIERS, false)).toBe(false);
  });

  it('blocks Free merchants above the cap', () => {
    expect(exceedsTierLimit(FREE_TIER_MAX_TIERS + 1, false)).toBe(true);
  });
});

describe('exceedsEarnRuleLimit', () => {
  it('never limits Pro merchants', () => {
    expect(exceedsEarnRuleLimit(100, true)).toBe(false);
  });

  it('allows Free merchants up to the cap and blocks above', () => {
    expect(exceedsEarnRuleLimit(FREE_TIER_MAX_EARN_RULES, false)).toBe(false);
    expect(exceedsEarnRuleLimit(FREE_TIER_MAX_EARN_RULES + 1, false)).toBe(true);
  });
});

describe('cap constants', () => {
  it('match the default seed size of 3', () => {
    expect(FREE_TIER_MAX_TIERS).toBe(3);
    expect(FREE_TIER_MAX_EARN_RULES).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- billing`
Expected: FAIL — cannot resolve `../../domain/billing.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/domain/billing.ts`:

```ts
/**
 * Free-tier caps for the loyalty program. Set to the default seed size
 * (DEFAULT_TIER_SEEDS / DEFAULT_EARN_RULE_SEEDS both seed 3 entries) so a fresh
 * install is never born over the limit. Pro lifts the cap entirely.
 *
 * Pure module: no Shopify imports, so the gate is unit-testable in isolation.
 */
export const FREE_TIER_MAX_TIERS = 3;
export const FREE_TIER_MAX_EARN_RULES = 3;

/** True when saving `count` tiers is not allowed on the current plan. */
export function exceedsTierLimit(count: number, isPro: boolean): boolean {
  if (isPro) return false;
  return count > FREE_TIER_MAX_TIERS;
}

/** True when saving `count` earn rules is not allowed on the current plan. */
export function exceedsEarnRuleLimit(count: number, isPro: boolean): boolean {
  if (isPro) return false;
  return count > FREE_TIER_MAX_EARN_RULES;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- billing`
Expected: PASS (3 describe blocks, all green).

- [ ] **Step 5: Commit**

```bash
git add src/domain/billing.ts src/__tests__/domain/billing.test.ts
git commit -m "feat(loyalty-engine): pure billing gate predicates"
```

---

## Task 2: Billing server adapter (`getActivePlan`, `managedPricingUrl`)

**Files:**
- Create: `app/loyalty/billing.server.ts`
- Test: `src/__tests__/loyalty/billing.server.test.ts`

Context: `adminGraphql<TData>(admin, query, variables?)` (in `app/loyalty/graphql.server.ts`)
calls `admin.graphql(...)`, parses `.json()`, and returns `json.data`. We reuse it.
`AdminApiContext` is the type of `admin` from `authenticate.admin(request)`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/loyalty/billing.server.test.ts`:

```ts
import {describe, it, expect} from 'vitest';
import {getActivePlan, managedPricingUrl} from '../../../app/loyalty/billing.server.js';

// Minimal fake AdminApiContext: only `.graphql` is used by getActivePlan.
function fakeAdmin(activeSubscriptions: Array<{name: string; status: string}>) {
  return {
    graphql: async () => ({
      ok: true,
      json: async () => ({
        data: {currentAppInstallation: {activeSubscriptions}},
      }),
    }),
  } as never;
}

function throwingAdmin() {
  return {
    graphql: async () => {
      throw new Error('network down');
    },
  } as never;
}

describe('getActivePlan', () => {
  it('is Pro when an ACTIVE subscription exists', async () => {
    const plan = await getActivePlan(fakeAdmin([{name: 'Pro', status: 'ACTIVE'}]));
    expect(plan).toEqual({isPro: true, planName: 'Pro'});
  });

  it('is Free when there are no active subscriptions', async () => {
    const plan = await getActivePlan(fakeAdmin([]));
    expect(plan).toEqual({isPro: false, planName: null});
  });

  it('ignores non-ACTIVE subscriptions', async () => {
    const plan = await getActivePlan(fakeAdmin([{name: 'Pro', status: 'CANCELLED'}]));
    expect(plan.isPro).toBe(false);
  });

  it('fails open to Free when the query throws', async () => {
    const plan = await getActivePlan(throwingAdmin());
    expect(plan).toEqual({isPro: false, planName: null});
  });
});

describe('managedPricingUrl', () => {
  it('builds the admin pricing-plans path from shop + handle', () => {
    const url = managedPricingUrl('demo-store.myshopify.com', 'ama-da-flow-loyalty');
    expect(url).toBe(
      'https://admin.shopify.com/store/demo-store/charges/ama-da-flow-loyalty/pricing_plans',
    );
  });

  it('handles a null shop domain by returning the generic charges path', () => {
    const url = managedPricingUrl(null, 'ama-da-flow-loyalty');
    expect(url).toBe(
      'https://admin.shopify.com/charges/ama-da-flow-loyalty/pricing_plans',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- billing.server`
Expected: FAIL — cannot resolve `billing.server.js`.

- [ ] **Step 3: Write minimal implementation**

Create `app/loyalty/billing.server.ts`:

```ts
import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {adminGraphql} from './graphql.server';

/**
 * Active billing plan for the current shop, derived from Shopify Managed
 * Pricing. During the 14-day trial Shopify reports the subscription as ACTIVE,
 * so trial merchants resolve to isPro=true with no extra trial handling.
 */
export type ActivePlan = {isPro: boolean; planName: string | null};

type ActiveSubscriptionsData = {
  currentAppInstallation: {
    activeSubscriptions: Array<{name: string; status: string}>;
  };
};

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        name
        status
      }
    }
  }
`;

/**
 * Resolve the shop's active plan. Fails OPEN to Free on any error: a billing
 * lookup outage must never block a merchant from using already-saved config
 * (reads are ungated) nor silently grant Pro. The only effect of fail-open is a
 * paying merchant briefly cannot add a 4th+ tier during an outage.
 */
export async function getActivePlan(admin: AdminApiContext): Promise<ActivePlan> {
  try {
    const data = await adminGraphql<ActiveSubscriptionsData>(
      admin,
      ACTIVE_SUBSCRIPTIONS_QUERY,
    );
    const active = data.currentAppInstallation.activeSubscriptions.find(
      (sub) => sub.status === 'ACTIVE',
    );
    return active
      ? {isPro: true, planName: active.name}
      : {isPro: false, planName: null};
  } catch {
    return {isPro: false, planName: null};
  }
}

/**
 * URL of the Shopify-hosted Managed Pricing page for the Upgrade CTA. `handle`
 * is the app handle from the Partner Dashboard (see SHOPIFY_APP_HANDLE env).
 */
export function managedPricingUrl(
  shopDomain: string | null,
  handle: string,
): string {
  const path = `charges/${handle}/pricing_plans`;
  if (!shopDomain) {
    return `https://admin.shopify.com/${path}`;
  }
  const store = shopDomain.replace(/\.myshopify\.com$/, '');
  return `https://admin.shopify.com/store/${store}/${path}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- billing.server`
Expected: PASS (both describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add app/loyalty/billing.server.ts src/__tests__/loyalty/billing.server.test.ts
git commit -m "feat(loyalty-engine): billing adapter - active plan + pricing URL"
```

---

## Task 3: Expose plan + pricing URL from the route loader

**Files:**
- Modify: `app/routes/app._index.tsx` (imports, loader)
- Modify: `.env.example`

- [ ] **Step 1: Add the app-handle env var to `.env.example`**

Append to `.env.example`:

```bash
# App handle from the Partner Dashboard (used to build the Managed Pricing
# upgrade link, e.g. admin.shopify.com/store/<shop>/charges/<handle>/pricing_plans).
# Find it under Partners > Apps > [app] > the URL slug / App setup.
SHOPIFY_APP_HANDLE=ama-da-flow-loyalty
```

- [ ] **Step 2: Add imports to `app/routes/app._index.tsx`**

After the existing `import {authenticate} from '../shopify.server';` line, add:

```ts
import {getActivePlan, managedPricingUrl} from '../loyalty/billing.server';
```

- [ ] **Step 3: Resolve the plan in the loader**

In `loader`, the first line is currently:

```ts
  const {admin} = await authenticate.admin(request);
  const [configuration, enabledState, displayState] = await Promise.all([
    fetchLoyaltyProgramConfiguration(admin),
    fetchProgramEnabled(admin),
    fetchDisplaySettings(admin),
  ]);
```

Add `getActivePlan(admin)` to the parallel batch:

```ts
  const {admin} = await authenticate.admin(request);
  const [configuration, enabledState, displayState, plan] = await Promise.all([
    fetchLoyaltyProgramConfiguration(admin),
    fetchProgramEnabled(admin),
    fetchDisplaySettings(admin),
    getActivePlan(admin),
  ]);
```

- [ ] **Step 4: Add plan fields to the loader return**

In the loader's returned object, after the existing `enabled` / `shopDomain` lines, add:

```ts
    isPro: plan.isPro,
    planName: plan.planName,
    pricingUrl: managedPricingUrl(
      enabledState.shopDomain ?? displayState.shopDomain,
      process.env.SHOPIFY_APP_HANDLE || 'ama-da-flow-loyalty',
    ),
```

- [ ] **Step 5: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS (no new errors). `useLoaderData<typeof loader>()` now carries `isPro`, `planName`, `pricingUrl`.

- [ ] **Step 6: Commit**

```bash
git add app/routes/app._index.tsx .env.example
git commit -m "feat(loyalty-engine): expose active plan + pricing URL to admin loader"
```

---

## Task 4: Enforce caps in the route action

**Files:**
- Modify: `app/routes/app._index.tsx` (ActionData type, action `saveTiers` + `saveEarnRules` cases)

- [ ] **Step 1: Extend the `ActionData` type**

The `ActionData` type (starts at line ~55) currently begins:

```ts
type ActionData = {
  status: 'success' | 'error';
  intent:
    | 'initializeProgram'
```

Add an `upgradeRequired` flag right after `syncedAt: string;`:

```ts
  message: string;
  syncedAt: string;
  upgradeRequired?: boolean;
  hasProgram?: boolean;
```

- [ ] **Step 2: Import the predicates**

Update the billing import added in Task 3 to also pull the predicates:

```ts
import {getActivePlan, managedPricingUrl} from '../loyalty/billing.server';
import {exceedsTierLimit, exceedsEarnRuleLimit} from '../../src/domain/billing.js';
```

> Path note: from `app/routes/app._index.tsx`, `../..` reaches the repo root, so
> `../../src/domain/billing.js`. The `.js` extension matches how `app/loyalty/*`
> already imports `src` modules (e.g. `admin.server.ts` imports
> `../../src/domain/program.js`).

- [ ] **Step 3: Gate the `saveTiers` case**

The current `saveTiers` case:

```ts
      case 'saveTiers': {
        const tiers = parseTierInputs(formData.get('tiersPayload'));
        const result = await saveTierConfiguration({admin, tiers});
```

Replace the first two lines of the case body with a plan check:

```ts
      case 'saveTiers': {
        const tiers = parseTierInputs(formData.get('tiersPayload'));
        const {isPro} = await getActivePlan(admin);
        if (exceedsTierLimit(tiers.length, isPro)) {
          return {
            status: 'error',
            intent,
            upgradeRequired: true,
            message:
              'The Free plan includes up to 3 reward tiers. Upgrade to Pro to add more.',
            syncedAt: new Date().toISOString(),
          };
        }
        const result = await saveTierConfiguration({admin, tiers});
```

- [ ] **Step 4: Gate the `saveEarnRules` case**

The current `saveEarnRules` case starts:

```ts
      case 'saveEarnRules': {
        const earnRules = parseEarnRuleInputs(formData.get('earnRulesPayload'));
        const result = await saveEarnRuleConfiguration({admin, earnRules});
```

Insert the plan check:

```ts
      case 'saveEarnRules': {
        const earnRules = parseEarnRuleInputs(formData.get('earnRulesPayload'));
        const {isPro} = await getActivePlan(admin);
        if (exceedsEarnRuleLimit(earnRules.length, isPro)) {
          return {
            status: 'error',
            intent,
            upgradeRequired: true,
            message:
              'The Free plan includes up to 3 earn rules. Upgrade to Pro to add more.',
            syncedAt: new Date().toISOString(),
          };
        }
        const result = await saveEarnRuleConfiguration({admin, earnRules});
```

- [ ] **Step 5: Verify typecheck + existing tests still pass**

Run: `npm run typecheck && npm test`
Expected: PASS. No existing test asserts on `saveTiers`/`saveEarnRules` action internals, so nothing regresses; `intent` is already in the `ActionData['intent']` union for both cases.

- [ ] **Step 6: Commit**

```bash
git add app/routes/app._index.tsx
git commit -m "feat(loyalty-engine): enforce Free-tier caps on tier and earn-rule saves"
```

---

## Task 5: Plan badge + Upgrade CTA in the admin UI

**Files:**
- Modify: `app/routes/app._index.tsx` (default `Index` component)

Context: the component reads `const data = useLoaderData<typeof loader>();` and uses
`useFetcher<ActionData>()` per editor (e.g. `saveFetcher`, `earnRulesSaveFetcher`).
UI uses Shopify Polaris web components (`s-*` elements, as seen in `app.tsx`'s
`<s-app-nav>` / `<s-link>`). Match that style.

- [ ] **Step 1: Render a plan badge near the program header**

In the `Index` component's returned JSX, locate the `ProgramStatus` / `ProgramHero`
header area (around the "App status: Active" text near line ~369). Immediately above
it, add a plan badge driven by loader data:

```tsx
        <s-badge tone={data.isPro ? 'success' : 'info'}>
          {data.isPro ? `Plan: ${data.planName ?? 'Pro'}` : 'Plan: Free'}
        </s-badge>
```

- [ ] **Step 2: Add a reusable upgrade banner element**

Within the `Index` component body (before the `return`), add a small derived flag and
banner node:

```tsx
  const showTierUpgrade =
    !data.isPro && data.tierEditorTiers.length >= 3;
  const showEarnRuleUpgrade =
    !data.isPro && data.earnRuleEditorEntries.length >= 3;

  const upgradeBanner = (label: string) => (
    <s-banner tone="info">
      {label}{' '}
      <s-link href={data.pricingUrl} target="_top">
        Upgrade to Pro
      </s-link>
    </s-banner>
  );
```

- [ ] **Step 3: Surface the banner above the tier and earn-rule editors**

Just above the `<TierEditor .../>` element, render the cap banner when at the limit:

```tsx
        {showTierUpgrade
          ? upgradeBanner('You have used all 3 Free reward tiers.')
          : null}
```

Just above the `<EarnRuleEditor .../>` element:

```tsx
        {showEarnRuleUpgrade
          ? upgradeBanner('You have used all 3 Free earn rules.')
          : null}
```

- [ ] **Step 4: Surface the action-time upgrade error**

The fetchers already render `ActionData.message`. Where `saveFetcher.data` /
`earnRulesSaveFetcher.data` messages are shown, no change is needed for the text — but
ensure an `upgradeRequired` response also shows the link. Add, near where save results
are rendered (after the editors), a conditional banner:

```tsx
        {saveFetcher.data?.upgradeRequired ||
        earnRulesSaveFetcher.data?.upgradeRequired
          ? upgradeBanner('That change needs the Pro plan.')
          : null}
```

- [ ] **Step 5: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS. `data.isPro`, `data.planName`, `data.pricingUrl` are all present on the
loader type from Task 3; `upgradeRequired` is on `ActionData` from Task 4.

- [ ] **Step 6: Manual smoke check (build only — full flow verified in Task 7 testing)**

Run: `npm run build`
Expected: build succeeds. (Live behavior is verified on a dev store in the
"Final verification" section below, since plan state requires a real subscription.)

- [ ] **Step 7: Commit**

```bash
git add app/routes/app._index.tsx
git commit -m "feat(loyalty-engine): plan badge + upgrade CTA in admin UI"
```

---

## Task 6: Documentation — check off Billing + Managed Pricing setup steps

**Files:**
- Modify: `STORE_LISTING.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update `STORE_LISTING.md`**

Under "Technical review readiness" (or add a new "Billing" subsection), add:

```markdown
## Billing (Shopify Managed Pricing)

- [x] Managed Pricing implemented — Free + Pro plans; app checks active
      subscription via `app/loyalty/billing.server.ts` (`getActivePlan`).
- [x] Soft feature gate — Free capped at 3 reward tiers + 3 earn rules
      (`src/domain/billing.ts`); enforced in `app/routes/app._index.tsx` action.
- [ ] **Partner Dashboard: create the Free and Pro plans** (Pricing → Managed
      Pricing). Pro = recurring price + 14-day trial.
- [ ] Set `SHOPIFY_APP_HANDLE` in Fly secrets to match the app handle.
- [ ] Verify on a development store: no-subscription = capped at 3 + upgrade CTA;
      subscribing to Pro (trial) lifts the cap.
```

- [ ] **Step 2: Update `HANDOFF.md`**

In the "App Store submission checklist" table, change the `Billing API` row from
`Pending (...)` to:

```markdown
| Billing API | Complete — Managed Pricing + soft gate (Free: 3 tiers/3 rules, Pro: unlimited). Partner Dashboard plans + `SHOPIFY_APP_HANDLE` still need to be set. |
```

And under "Pending deploy steps", add after the existing steps:

```markdown
# 4. Create Managed Pricing plans in Partner Dashboard
#    Partners → Apps → [app] → Pricing → Managed Pricing
#    - Free plan (no charge)
#    - Pro plan (recurring price, 14-day trial)
#    Then: flyctl secrets set SHOPIFY_APP_HANDLE=<app-handle>
```

- [ ] **Step 3: Commit**

```bash
git add STORE_LISTING.md HANDOFF.md
git commit -m "docs(loyalty-engine): mark Billing complete; add Managed Pricing setup"
```

---

## Final verification

- [ ] **Run the full suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: all tests pass (including the new `billing` and `billing.server` suites),
typecheck clean.

- [ ] **Manual end-to-end (development store, after `shopify app deploy` + plans created)**

1. Install on a fresh dev store → app usable, badge shows `Plan: Free`, 3 seeded
   tiers/rules present, adding a 4th shows the Upgrade CTA and the save is rejected.
2. Subscribe to Pro via the hosted pricing page → badge shows `Plan: Pro`, caps lifted,
   4th tier/rule saves successfully.
3. Cancel Pro → reverts to Free behavior on next load.

---

## Notes for the implementer

- **App Bridge navigation:** `<s-link href={pricingUrl} target="_top">` should break out
  of the embedded iframe to the admin pricing page. If during Task 7 testing the link
  stays trapped in the iframe, switch the href to the App Bridge form
  `shopify://admin/charges/<handle>/pricing_plans` (handled by `managedPricingUrl` —
  add a variant if needed). This is the one runtime behavior to confirm on a real
  store during the "Final verification" manual end-to-end run.
- **Plan name matching:** `getActivePlan` keys only on `status === 'ACTIVE'`, not the
  plan name, so renaming "Pro" in the Dashboard won't break the gate. `planName` is
  display-only.
- **Do not gate** referral reconciliation (`app.customers.tsx`), redemptions, or the
  customer-account extension — per the approved spec these stay free.
