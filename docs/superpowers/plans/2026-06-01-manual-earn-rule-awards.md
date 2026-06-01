# Manual Earn-Rule Awards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let merchants award the otherwise-untriggered earn-rule actions (birthday, review, newsletter, social follows, custom) to a specific customer from the Customers page, with a per-rule one-time/repeatable flag.

**Architecture:** A pure `projectManualAward` (balance + idempotency) in the domain layer; a `repeatable` boolean added to the earn-rule metaobject and its config; a `awardEarnRuleToCustomer` server function that reuses `fetchCustomerPointsState` + `syncCustomerLoyaltyState`; and admin UI on the earn-rule editor (Repeatable toggle) and Customers page (Award control).

**Tech Stack:** TypeScript, React Router 7, Shopify Polaris web components (`s-*`), Shopify Admin GraphQL + metaobjects, Vitest (node).

**Spec:** `docs/superpowers/specs/2026-06-01-manual-earn-rule-awards-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/domain/customer-state.ts` | **+** pure `projectManualAward` + types |
| `src/__tests__/domain/manual-award.test.ts` | **new** unit tests for the projection |
| `src/domain/program.ts` | **+** `repeatable` on `LoyaltyEarnRuleConfig` + normaliser read |
| `src/__tests__/domain/program.test.ts` | **+** test the `repeatable` read |
| `app/loyalty/constants.ts` | **+** `MANUAL_EARN_ELIGIBLE_ACTIONS` + `isManualEarnEligible` |
| `src/__tests__/domain/billing.test.ts` | (unrelated; untouched) |
| `src/__tests__/loyalty/manual-eligible.test.ts` | **new** eligibility test |
| `app/loyalty/earn-rules-redemptions-admin.server.ts` | **+** `repeatable` in types/build/sanitize/persist/seeds |
| `app/loyalty/admin.server.ts` | **+** `repeatable` field on earn-rule definition; fix description string |
| `app/loyalty/customer-state.server.ts` | **+** `awardEarnRuleToCustomer` |
| `app/components/loyalty-admin-ui.tsx` | **+** Repeatable toggle + corrected help text |
| `app/routes/app._index.tsx` | **+** parse/serialize/draft `repeatable` |
| `app/routes/app.customers.tsx` | **+** intent-based action, manual-eligible rules in loader, Award UI |

**Task order:** 1 (pure projection) → 2 (eligibility) → 3 (repeatable plumbing) → 4 (server award) → 5 (Customers UI) → 6 (editor UI). Later tasks depend on earlier ones.

---

## Task 1: Pure `projectManualAward`

**Files:**
- Modify: `src/domain/customer-state.ts`
- Test: `src/__tests__/domain/manual-award.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/domain/manual-award.test.ts`:

```ts
import {describe, it, expect} from 'vitest';
import {projectManualAward, type ManualAwardRule} from '../../domain/customer-state.js';

const rule = (over: Partial<ManualAwardRule> = {}): ManualAwardRule => ({
  handle: 'review-1',
  action: 'review',
  pointsValue: 50,
  active: true,
  repeatable: false,
  ...over,
});

describe('projectManualAward', () => {
  it('awards points to a fresh customer for an eligible one-time rule', () => {
    const r = projectManualAward({rule: rule(), currentBalance: 100, awardedRules: []});
    expect(r.status).toBe('awarded');
    expect(r.pointsAwarded).toBe(50);
    expect(r.newBalance).toBe(150);
    expect(r.newAwardedRules).toEqual(['review-1']);
  });

  it('skips a one-time rule already in awardedRules', () => {
    const r = projectManualAward({rule: rule(), currentBalance: 100, awardedRules: ['review-1']});
    expect(r.status).toBe('already_awarded');
    expect(r.pointsAwarded).toBe(0);
    expect(r.newBalance).toBe(100);
    expect(r.newAwardedRules).toEqual(['review-1']);
  });

  it('re-awards a repeatable rule even if already in awardedRules', () => {
    const r = projectManualAward({
      rule: rule({repeatable: true}),
      currentBalance: 100,
      awardedRules: ['review-1'],
    });
    expect(r.status).toBe('awarded');
    expect(r.newBalance).toBe(150);
    expect(r.newAwardedRules).toEqual(['review-1']); // unchanged for repeatable
  });

  it('rejects a rule with null points value', () => {
    const r = projectManualAward({rule: rule({pointsValue: null}), currentBalance: 100, awardedRules: []});
    expect(r.status).toBe('rejected');
    expect(r.newBalance).toBe(100);
  });

  it('rejects a rule with zero or negative points value', () => {
    expect(projectManualAward({rule: rule({pointsValue: 0}), currentBalance: 10, awardedRules: []}).status).toBe('rejected');
    expect(projectManualAward({rule: rule({pointsValue: -5}), currentBalance: 10, awardedRules: []}).status).toBe('rejected');
  });

  it('rejects an inactive rule', () => {
    const r = projectManualAward({rule: rule({active: false}), currentBalance: 100, awardedRules: []});
    expect(r.status).toBe('rejected');
  });

  it('dedupes the handle when appending to awardedRules', () => {
    const r = projectManualAward({rule: rule({handle: 'b'}), currentBalance: 0, awardedRules: ['a']});
    expect(r.newAwardedRules).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- manual-award`
Expected: FAIL — `projectManualAward` is not exported from `../../domain/customer-state.js`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/domain/customer-state.ts` (after the existing exports):

```ts
/**
 * A single earn rule, reduced to what a manual award needs. Built from
 * LoyaltyEarnRuleConfig at the call site.
 */
export type ManualAwardRule = {
  handle: string;
  action: string;
  pointsValue: number | null;
  active: boolean;
  repeatable: boolean;
};

export type ManualAwardResult = {
  status: 'awarded' | 'already_awarded' | 'rejected';
  reason?: string;
  newBalance: number;
  pointsAwarded: number;
  newAwardedRules: string[];
};

/**
 * Pure projection for a manual earn-rule award. Decides whether the rule can be
 * awarded and computes the resulting balance + awardedRules ledger.
 *
 * - Inactive rule or non-positive pointsValue -> rejected (no change).
 * - One-time rule (repeatable === false) already in awardedRules -> already_awarded.
 * - Otherwise -> awarded; one-time rules append their handle to awardedRules,
 *   repeatable rules leave awardedRules unchanged.
 *
 * Manual eligibility by ACTION is enforced at the call site, not here.
 */
export function projectManualAward({
  rule,
  currentBalance,
  awardedRules,
}: {
  rule: ManualAwardRule;
  currentBalance: number;
  awardedRules: string[];
}): ManualAwardResult {
  if (!rule.active) {
    return {
      status: 'rejected',
      reason: 'Rule is inactive',
      newBalance: currentBalance,
      pointsAwarded: 0,
      newAwardedRules: awardedRules,
    };
  }

  if (rule.pointsValue === null || rule.pointsValue <= 0) {
    return {
      status: 'rejected',
      reason: 'Rule has no positive points value',
      newBalance: currentBalance,
      pointsAwarded: 0,
      newAwardedRules: awardedRules,
    };
  }

  if (!rule.repeatable && awardedRules.includes(rule.handle)) {
    return {
      status: 'already_awarded',
      newBalance: currentBalance,
      pointsAwarded: 0,
      newAwardedRules: awardedRules,
    };
  }

  return {
    status: 'awarded',
    newBalance: currentBalance + rule.pointsValue,
    pointsAwarded: rule.pointsValue,
    newAwardedRules: rule.repeatable
      ? awardedRules
      : [...new Set([...awardedRules, rule.handle])],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- manual-award`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/customer-state.ts src/__tests__/domain/manual-award.test.ts
git commit -m "feat(loyalty-engine): pure projectManualAward projection"
```

---

## Task 2: Manual-eligible action constant

**Files:**
- Modify: `app/loyalty/constants.ts`
- Test: `src/__tests__/loyalty/manual-eligible.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/loyalty/manual-eligible.test.ts`:

```ts
import {describe, it, expect} from 'vitest';
import {
  MANUAL_EARN_ELIGIBLE_ACTIONS,
  isManualEarnEligible,
} from '../../../app/loyalty/constants.js';

describe('isManualEarnEligible', () => {
  it('is true for the six manually-awarded actions', () => {
    for (const action of ['birthday', 'follow_instagram', 'follow_tiktok', 'review', 'newsletter', 'custom']) {
      expect(isManualEarnEligible(action)).toBe(true);
    }
  });

  it('is false for the auto-awarded actions', () => {
    for (const action of ['order', 'signup', 'referral']) {
      expect(isManualEarnEligible(action)).toBe(false);
    }
  });

  it('exposes the eligible set', () => {
    expect(MANUAL_EARN_ELIGIBLE_ACTIONS).toContain('review');
    expect(MANUAL_EARN_ELIGIBLE_ACTIONS).not.toContain('order');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- manual-eligible`
Expected: FAIL — exports not found in `constants.js`.

- [ ] **Step 3: Write minimal implementation**

Append to `app/loyalty/constants.ts`:

```ts
/**
 * Earn-rule actions that can be awarded manually from the Customers page.
 * Excludes the actions that already award automatically: `order` (per paid
 * order), `signup` (first-order projection), `referral` (referral credit).
 */
export const MANUAL_EARN_ELIGIBLE_ACTIONS = [
  'birthday',
  'follow_instagram',
  'follow_tiktok',
  'review',
  'newsletter',
  'custom',
] as const;

export function isManualEarnEligible(action: string): boolean {
  return (MANUAL_EARN_ELIGIBLE_ACTIONS as readonly string[]).includes(action);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- manual-eligible`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/loyalty/constants.ts src/__tests__/loyalty/manual-eligible.test.ts
git commit -m "feat(loyalty-engine): manual-eligible earn-rule actions"
```

---

## Task 3: `repeatable` field plumbing (config + persistence + definition)

**Files:**
- Modify: `src/domain/program.ts` (`LoyaltyEarnRuleConfig` + `normalizeEarnRuleEntries`)
- Modify: `app/loyalty/earn-rules-redemptions-admin.server.ts` (types, build, sanitize, persist, seeds)
- Modify: `app/loyalty/admin.server.ts` (definition field)
- Test: `src/__tests__/domain/program.test.ts` (add a case)

Context: `LoyaltyEarnRuleEditorEntry` uses string fields like `active: 'true'|'false'`;
`LoyaltyEarnRuleInput` uses booleans. The metaobject persists string field values.
`normalizeEarnRuleEntries` builds the runtime `LoyaltyEarnRuleConfig` from entries.
The metaobject definition reconcile auto-creates any field present in the blueprint
but missing on the live definition.

- [ ] **Step 1: Write the failing test for the runtime read**

Add to `src/__tests__/domain/program.test.ts` (new describe block at the end):

```ts
import {normalizeEarnRuleEntries} from '../../domain/program.js';

describe('normalizeEarnRuleEntries repeatable', () => {
  const entry = (fields: Record<string, string>) => ({
    id: 'gid://x/1',
    handle: 'review-1',
    type: 'loyalty_earn_rule',
    fields,
  });

  it('reads repeatable=true', () => {
    const {earnRules} = normalizeEarnRuleEntries([
      entry({title: 'Review', action: 'review', active: 'true', repeatable: 'true', points_value: '50'}),
    ]);
    expect(earnRules[0].repeatable).toBe(true);
  });

  it('defaults repeatable to false when the field is absent', () => {
    const {earnRules} = normalizeEarnRuleEntries([
      entry({title: 'Review', action: 'review', active: 'true', points_value: '50'}),
    ]);
    expect(earnRules[0].repeatable).toBe(false);
  });
});
```

> Note: confirm the `type` string and `MerchantMetaobjectEntry` shape match the file's
> existing test helpers if any. If `normalizeEarnRuleEntries` requires a specific
> `type` constant, import `LOYALTY_METAOBJECT_TYPES` from `../../domain/program.js`
> and use `LOYALTY_METAOBJECT_TYPES.earnRule` instead of the literal `'loyalty_earn_rule'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- program`
Expected: FAIL — `earnRules[0].repeatable` is `undefined` (property doesn't exist yet).

- [ ] **Step 3a: Add `repeatable` to the config type + normaliser**

In `src/domain/program.ts`, in `LoyaltyEarnRuleConfig` add the field after `active`:

```ts
export type LoyaltyEarnRuleConfig = {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  action: LoyaltyEarnAction | string;
  pointsValue: number | null;
  active: boolean;
  repeatable: boolean;
};
```

In `normalizeEarnRuleEntries`, in the `earnRules.push({...})` object, add after `active`:

```ts
      active: getOptionalBoolean(entry, 'active') ?? true,
      repeatable: getOptionalBoolean(entry, 'repeatable') ?? false,
```

- [ ] **Step 3b: Add `repeatable` to the editor/input types + build + sanitize + persist + seeds**

In `app/loyalty/earn-rules-redemptions-admin.server.ts`:

(i) `LoyaltyEarnRuleEditorEntry` — add after `active: string;`:

```ts
  active: string; // 'true' | 'false'
  repeatable: string; // 'true' | 'false'
};
```

(ii) `LoyaltyEarnRuleInput` — add after `active: boolean;`:

```ts
  active: boolean;
  repeatable: boolean;
};
```

(iii) `buildEarnRuleEditorEntries` — in the `acc.push({...})` add after `active`:

```ts
      active: entry.fields.active?.trim() ?? 'true',
      repeatable: entry.fields.repeatable?.trim() ?? 'false',
```

and in the fallback `DEFAULT_EARN_RULE_SEEDS.map((seed) => ({...}))` add after `active`:

```ts
        active: seed.active ? 'true' : 'false',
        repeatable: seed.repeatable ? 'true' : 'false',
```

(iv) `DEFAULT_EARN_RULE_SEEDS` — add `repeatable: false,` to each of the three seed
objects (signup, order, referral), e.g.:

```ts
  {
    handle: 'signup',
    title: 'Create an account',
    description: 'Welcome bonus when a customer joins.',
    action: 'signup',
    pointsValue: 200,
    active: true,
    repeatable: false,
  },
```

(Repeat `repeatable: false,` for the `order` and `referral` seeds.)

(v) `applyEarnRuleEntries` — in the `fields` array push, add the `repeatable` field after
the `active` entry:

```ts
    const fields: Array<{key: string; value: string}> = [
      {key: 'title', value: rule.title},
      {key: 'action', value: rule.action},
      {key: 'active', value: rule.active ? 'true' : 'false'},
      {key: 'repeatable', value: rule.repeatable ? 'true' : 'false'},
    ];
```

(vi) `sanitizeEarnRuleInputs` — in the returned object add after `active`:

```ts
      active: rule.active !== false,
      repeatable: rule.repeatable === true,
```

- [ ] **Step 3c: Add the `repeatable` field to the earn-rule metaobject definition**

In `app/loyalty/admin.server.ts`, in the earn-rule blueprint's `fieldDefinitions`
array (the one under `type: LOYALTY_METAOBJECT_TYPES.earnRule`), add after the
`active` field:

```ts
      {
        key: 'active',
        name: 'Active',
        type: 'boolean',
      },
      {
        key: 'repeatable',
        name: 'Repeatable',
        type: 'boolean',
      },
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -- program`
Expected: PASS (the two new `repeatable` cases, plus existing program tests).

Run: `npm run typecheck`
Expected: only the 2 pre-existing `loyalty-discount` codegen errors. New errors would
most likely be "property `repeatable` is missing" — if so, ensure every place that
constructs a `LoyaltyEarnRuleInput` (seeds) or `LoyaltyEarnRuleEditorEntry`
(`buildEarnRuleEditorEntries`, and `createEmptyEarnRuleDraft`/`toEarnRuleDrafts` in
`app/routes/app._index.tsx`) sets `repeatable`. Task 6 covers the `app._index.tsx`
constructors; if typecheck fails here because of them, add `repeatable: 'false'` to
`createEmptyEarnRuleDraft` and ensure `toEarnRuleDrafts` spreads the entry (it already
spreads `LoyaltyEarnRuleEditorEntry`, so it inherits `repeatable`).

> If `npm run typecheck` reports missing `repeatable` in `app/routes/app._index.tsx`
> constructors, apply the `createEmptyEarnRuleDraft` change from Task 6 Step 3 now so
> the build stays green, and skip that sub-step when you reach Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/domain/program.ts app/loyalty/earn-rules-redemptions-admin.server.ts app/loyalty/admin.server.ts src/__tests__/domain/program.test.ts
git commit -m "feat(loyalty-engine): repeatable flag on earn rules (config + persistence + definition)"
```

---

## Task 4: `awardEarnRuleToCustomer` server function

**Files:**
- Modify: `app/loyalty/customer-state.server.ts`

Context: `fetchCustomerPointsState(admin, customerAdminId)` returns
`{pointsBalance, awardedRules, lastOrderId, ...}`. `syncCustomerLoyaltyState({admin,
customerAdminId, program, pointsBalance?, awardedRules?, lastOrderId?})` re-fetches
spend metrics, rebuilds the full state, and writes BOTH the `loyalty_state` and
`loyalty_points_balance` metafields. It returns `null` if the customer has no spend
metrics. We must pass `lastOrderId` through so order-idempotency state isn't dropped.

- [ ] **Step 1: Add imports**

At the top of `app/loyalty/customer-state.server.ts`, ensure these are imported:

- From `../../src/domain/customer-state.js` (the existing import block from this
  module): add `projectManualAward` and `type ManualAwardRule`.
- From `./constants`: add `isManualEarnEligible`.

(Find the existing `import {... } from '../../src/domain/customer-state.js';` and the
existing `import {...} from './constants';` lines and extend them. `LoyaltyProgramConfig`
is already imported in this file.)

- [ ] **Step 2: Add the function**

Append to `app/loyalty/customer-state.server.ts`:

```ts
/**
 * Manually award an earn rule's points to a single customer (Customers page).
 * Only active, manual-eligible rules (not order/signup/referral) can be awarded.
 * One-time rules are idempotent via the awardedRules ledger; repeatable rules
 * can be awarded repeatedly. Preserves lastOrderId so order idempotency holds.
 */
export async function awardEarnRuleToCustomer({
  admin,
  customerAdminId,
  ruleHandle,
  program,
}: {
  admin: AdminApiContext;
  customerAdminId: string;
  ruleHandle: string;
  program: LoyaltyProgramConfig;
}): Promise<{
  status: 'awarded' | 'already_awarded' | 'rejected';
  message: string;
}> {
  const rule = program.earnRules.find(
    (entry) => entry.handle === ruleHandle && entry.active,
  );
  if (!rule) {
    return {
      status: 'rejected',
      message: `No active earn rule "${ruleHandle}" exists in the program.`,
    };
  }
  if (!isManualEarnEligible(rule.action)) {
    return {
      status: 'rejected',
      message: `"${rule.title}" (${rule.action}) is awarded automatically and cannot be granted manually.`,
    };
  }

  const current = await fetchCustomerPointsState(admin, customerAdminId);
  const manualRule: ManualAwardRule = {
    handle: rule.handle,
    action: rule.action,
    pointsValue: rule.pointsValue,
    active: rule.active,
    repeatable: rule.repeatable,
  };
  const projection = projectManualAward({
    rule: manualRule,
    currentBalance: current.pointsBalance,
    awardedRules: current.awardedRules,
  });

  if (projection.status === 'already_awarded') {
    return {
      status: 'already_awarded',
      message: `"${rule.title}" was already awarded to this customer.`,
    };
  }
  if (projection.status === 'rejected') {
    return {
      status: 'rejected',
      message: projection.reason ?? `"${rule.title}" cannot be awarded.`,
    };
  }

  const synced = await syncCustomerLoyaltyState({
    admin,
    customerAdminId,
    program,
    pointsBalance: projection.newBalance,
    awardedRules: projection.newAwardedRules,
    lastOrderId: current.lastOrderId ?? undefined,
  });

  if (!synced) {
    return {
      status: 'rejected',
      message: 'Customer has no spend metrics yet; cannot award points.',
    };
  }

  return {
    status: 'awarded',
    message: `Awarded ${projection.pointsAwarded} points for "${rule.title}".`,
  };
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: only the 2 pre-existing `loyalty-discount` codegen errors. `program.earnRules`
elements now have `repeatable` (Task 3), so `rule.repeatable` typechecks.

Run: `npm test`
Expected: all pass (no new tests here; this IO function is verified on a dev store).

- [ ] **Step 4: Commit**

```bash
git add app/loyalty/customer-state.server.ts
git commit -m "feat(loyalty-engine): awardEarnRuleToCustomer server function"
```

---

## Task 5: Customers page — Award control + intent action

**Files:**
- Modify: `app/routes/app.customers.tsx`

Context: the route currently has a single `action` that only runs
`reconcilePendingReferrals` and returns `{reconcile}`. We convert it to an
intent-based action, add `awardEarnRule`, expose manual-eligible rules from the
loader, and add a per-row Award control. The page uses `useActionData` (not fetchers)
and Polaris `s-*` elements.

- [ ] **Step 1: Extend imports**

Update the import from `../loyalty/customer-state.server` to add `awardEarnRuleToCustomer`:

```ts
import {
  reconcilePendingReferrals,
  awardEarnRuleToCustomer,
  type ReconcileReferralsResult,
} from '../loyalty/customer-state.server';
```

Add an import for the eligibility helper:

```ts
import {isManualEarnEligible} from '../loyalty/constants';
```

- [ ] **Step 2: Make the action intent-based**

Replace the existing `action` function body with:

```ts
export const action = async ({request}: ActionFunctionArgs) => {
  const {admin} = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get('intent');
  const configuration = await fetchLoyaltyProgramConfiguration(admin);
  const program = configuration.syncPlan.program;

  if (intent === 'awardEarnRule') {
    const customerId = formData.get('customerId');
    const ruleHandle = formData.get('ruleHandle');
    if (typeof customerId !== 'string' || typeof ruleHandle !== 'string' || !ruleHandle) {
      return {award: {status: 'rejected' as const, message: 'Pick a reward to award.', customerId: typeof customerId === 'string' ? customerId : ''}};
    }
    if (!program) {
      return {award: {status: 'rejected' as const, message: 'Initialize the program first.', customerId}};
    }
    const result = await awardEarnRuleToCustomer({admin, customerAdminId: customerId, ruleHandle, program});
    return {award: {...result, customerId}};
  }

  // Default intent: reconcile pending referrals.
  const bonusPoints = program
    ? (program.earnRules.find((r) => r.active && r.action === 'referral')?.pointsValue ?? 0)
    : 0;
  const result = await reconcilePendingReferrals(admin, bonusPoints);
  return {reconcile: result};
};
```

- [ ] **Step 3: Expose manual-eligible rules from the loader**

In the `loader`, after `program` is resolved (the `const program = configuration.syncPlan.program;`
line already exists), build the list and add it to the returned object. Add this just
before `const rows: CustomerRow[] = ...`:

```ts
  const manualRules = program
    ? program.earnRules
        .filter((rule) => rule.active && isManualEarnEligible(rule.action))
        .map((rule) => ({
          handle: rule.handle,
          title: rule.title,
          pointsValue: rule.pointsValue,
        }))
    : [];
```

And in the loader's `return {...}` object add:

```ts
    rows,
    manualRules,
    cursor: page.customers.pageInfo.hasNextPage
```

- [ ] **Step 4: Read award result + rules in the component**

In `CustomersRoute`, after the existing `const reconcileResult = ...` line, add:

```ts
  const awardResult = actionData && 'award' in actionData ? actionData.award : undefined;
  const reconcileResultData = actionData && 'reconcile' in actionData ? actionData.reconcile : undefined;
```

Then change the existing `reconcileResult` usage to use `reconcileResultData`:
replace
```ts
  const reconcileResult = actionData?.reconcile as ReconcileReferralsResult | undefined;
```
with
```ts
  const reconcileResult = reconcileResultData as ReconcileReferralsResult | undefined;
```

- [ ] **Step 5: Add the award result banner + a new table column**

Add an award banner at the top of the "Loyalty members" `s-section`, right after the
`{!data.hasProgram ? (...) : null}` block:

```tsx
        {awardResult ? (
          <s-banner
            tone={
              awardResult.status === 'awarded'
                ? 'success'
                : awardResult.status === 'already_awarded'
                  ? 'info'
                  : 'critical'
            }
          >
            <s-paragraph>{awardResult.message}</s-paragraph>
          </s-banner>
        ) : null}
```

Add a header cell for the new column — after `<s-table-header>Active redemption</s-table-header>`:

```tsx
              <s-table-header>Active redemption</s-table-header>
              <s-table-header>Award points</s-table-header>
```

Add the per-row award control — after the `Active redemption` `<s-table-cell>` block,
add a new cell. Render the control only when there are manual rules:

```tsx
                  <s-table-cell>
                    {data.manualRules.length > 0 ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="awardEarnRule" />
                        <input type="hidden" name="customerId" value={row.id} />
                        <s-stack direction="inline" gap="small">
                          <s-select name="ruleHandle" label="Reward" labelaccessibilityvisibility="exclusive">
                            {data.manualRules.map((rule) => (
                              <s-option key={rule.handle} value={rule.handle}>
                                {rule.title}
                                {rule.pointsValue ? ` (+${rule.pointsValue})` : ''}
                              </s-option>
                            ))}
                          </s-select>
                          <s-button variant="secondary" type="submit">Award</s-button>
                        </s-stack>
                      </Form>
                    ) : (
                      <s-text>—</s-text>
                    )}
                  </s-table-cell>
```

> Note on `labelaccessibilityvisibility`: this hides the visible label on the select
> while keeping it accessible. If the linter/types reject that attribute for `s-select`,
> drop the attribute and keep `label="Reward"` (a visible label is acceptable). Verify
> against existing `s-select` usage in `app/components/loyalty-admin-ui.tsx`.

- [ ] **Step 6: Give the reconcile Form an explicit intent**

The action is now intent-based; the reconcile form must declare its intent. In the
"Referral reconciliation" section, update the reconcile `<Form>`:

```tsx
        <Form method="post">
          <input type="hidden" name="intent" value="reconcile" />
          <s-button
            variant="secondary"
            type="submit"
            disabled={isReconciling || undefined}
          >
            {isReconciling ? 'Reconciling…' : 'Reconcile pending referrals'}
          </s-button>
        </Form>
```

(The default branch in the action also handles a missing intent, so this is belt-and-braces.)

- [ ] **Step 7: Verify**

Run: `npm run typecheck`
Expected: only the 2 pre-existing `loyalty-discount` codegen errors. The action now
returns a union `{reconcile} | {award}`; the `'award' in actionData` / `'reconcile' in
actionData` guards narrow it.

Run: `node ./scripts/run-eslint.cjs app/routes/app.customers.tsx`
Expected: clean.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 8: Commit**

```bash
git add app/routes/app.customers.tsx
git commit -m "feat(loyalty-engine): award earn-rule points to a customer from Customers page"
```

---

## Task 6: Earn-rule editor — Repeatable toggle + corrected copy

**Files:**
- Modify: `app/components/loyalty-admin-ui.tsx` (Repeatable toggle, help text)
- Modify: `app/routes/app._index.tsx` (parse + draft `repeatable`)
- Modify: `app/loyalty/admin.server.ts` (definition description string)

Context: `EarnRuleDraft = LoyaltyEarnRuleEditorEntry & {clientId}` so it already carries
`repeatable: string` after Task 3. The editor row has an `Active` `s-select`; we add a
`Repeatable` one beside it. `parseEarnRuleInputs` in `app._index.tsx` builds
`LoyaltyEarnRuleInput` from the posted JSON and must read `repeatable`.
`createEmptyEarnRuleDraft` must initialise it.

- [ ] **Step 1: Add the Repeatable select to the earn-rule editor row**

In `app/components/loyalty-admin-ui.tsx`, in the earn-rule row component, directly
after the `Active` `<s-select>` block (the one with `value={rule.active}` and
`onUpdate({active: ...})`), add:

```tsx
        <s-select
          label="Awarding"
          value={rule.repeatable}
          onChange={(event: Event) => onUpdate({repeatable: getEventValue(event)})}
        >
          <s-option value="false">One-time per customer</s-option>
          <s-option value="true">Repeatable</s-option>
        </s-select>
```

- [ ] **Step 2: Fix the misleading help text**

In `app/components/loyalty-admin-ui.tsx`, find the earn-rule editor help copy near
line ~601 ("(signup, order, birthday, follow, review, referral) until you author …")
and reword the surrounding sentence to state how awarding works. Replace that
parenthetical clause with:

```
order, signup, and referral award points automatically; birthday, review,
newsletter, and social-follow rules are awarded manually from the Customers page
```

(Keep the rest of the sentence/structure; only correct the claim. If the exact
sentence differs, adjust wording to convey: order/signup/referral are automatic, the
rest are manual.)

- [ ] **Step 3: Initialise `repeatable` in `createEmptyEarnRuleDraft`**

In `app/routes/app._index.tsx`, in `createEmptyEarnRuleDraft`, add `repeatable` after
`active`:

```ts
    active: 'true',
    repeatable: 'false',
  };
}
```

(Skip this step if you already applied it during Task 3 Step 4 to keep typecheck green.)

- [ ] **Step 4: Parse `repeatable` from the posted payload**

In `app/routes/app._index.tsx`, in `parseEarnRuleInputs`, in the returned object add
after the `active` line:

```ts
      active:
        typeof record.active === 'string' ? record.active !== 'false' : true,
      repeatable:
        typeof record.repeatable === 'string' ? record.repeatable === 'true' : false,
    };
```

- [ ] **Step 5: Update the definition description string**

In `app/loyalty/admin.server.ts`, update the earn-rule definition `description` (the
one reading `'Actions that award loyalty points (signup, order, birthday, review,
referral, …).'`) to:

```ts
    description:
      'Loyalty earn rules. order/signup/referral award automatically; other actions are awarded manually from the Customers page.',
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: only the 2 pre-existing `loyalty-discount` codegen errors. `EarnRuleDraft`
carries `repeatable` (Task 3), so the `onUpdate({repeatable})` patch and `value={rule.repeatable}`
typecheck.

Run: `node ./scripts/run-eslint.cjs app/components/loyalty-admin-ui.tsx app/routes/app._index.tsx`
Expected: clean.

Run: `npm test`
Expected: all pass.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add app/components/loyalty-admin-ui.tsx app/routes/app._index.tsx app/loyalty/admin.server.ts
git commit -m "feat(loyalty-engine): repeatable toggle + corrected earn-rule award copy"
```

---

## Final verification

- [ ] **Full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests pass (including `manual-award`, `manual-eligible`, and the new
`program` repeatable cases); typecheck shows only the 2 pre-existing `loyalty-discount`
codegen errors; build succeeds.

- [ ] **Manual end-to-end (dev store, after `shopify app deploy` so the new `repeatable`
      metaobject field exists)**

1. Open the Home tab earn-rule editor → create a `review` rule (action = Review,
   points = 50, Awarding = One-time per customer) and save.
2. Open Customers → pick a customer → select the review reward → click Award.
   Balance increases by 50; success banner shows.
3. Award the same one-time rule again → "already awarded" info banner; balance
   unchanged.
4. Edit the rule to Repeatable, save, award twice → balance increases each time.
5. Confirm order/signup/referral rules do NOT appear in the Award dropdown.

---

## Notes for the implementer

- **Don't gate this behind billing.** Manual awards are not part of the Free/Pro tier
  gate; leave the billing checks (tiers/earn-rule count) untouched.
- **`program.earnRules` is already active-filtered** by `normalizeLoyaltyProgram`, so
  inactive rules won't appear in the award dropdown or be found by
  `awardEarnRuleToCustomer` — the `active` checks are defensive but correct.
- **Idempotency key is the rule handle**, shared with the existing `awardedRules`
  ledger that also stores `'signup'`. Manual-eligible actions exclude signup/referral,
  so there is no collision.
- **`lastOrderId` must be preserved** through `syncCustomerLoyaltyState` (done in
  Task 4) or the orders/paid idempotency guard could re-award the last order.
