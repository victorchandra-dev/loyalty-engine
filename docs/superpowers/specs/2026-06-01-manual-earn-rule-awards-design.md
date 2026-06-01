# Manual Earn-Rule Awards — Design

**Date:** 2026-06-01
**Status:** Approved design (pending spec review)
**Goal:** Make the currently-unwired earn-rule actions actually award points, via a
generic merchant-fired "award" mechanism, so the app does what its listing claims.

## Background

Audit of the points engine found that only 3 of 9 earn-rule actions award points
end-to-end:

- `order` — `computeOrderPoints` on `orders/paid`.
- `signup` — `getOneShotEarnPoints('signup')` via `projectPointsAwardForOrder`, on
  first paid order.
- `referral` — `getOneShotEarnPoints('referral')` on `orders/paid` + referral
  attribution/reconcile.

The other 6 (`birthday`, `review`, `newsletter`, `follow_instagram`,
`follow_tiktok`, `custom`) are selectable in the admin and surface in the storefront
but have **no trigger** — points are never awarded. Three of them
(`review`, social follows) are not verifiable through any Shopify event, so a
bespoke automatic trigger is impossible. The decided solution is one generic,
merchant-fired award capability that covers all of them.

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Mechanism | **Generic manual award** (one capability covers all unverifiable actions) |
| Repeatability | **Per-rule `repeatable` flag**, default **false** (one-time) |
| Firing surface | **Admin UI only** — the existing Customers page |
| Manual-eligible actions | All active earn rules EXCEPT `order`, `signup`, `referral` (those auto-award) |
| Out of scope | Automatic triggers (newsletter webhook, birthday cron); authenticated API for Flow/Zapier |

### Why exclude `order`/`signup`/`referral`

`order` is purchase-driven (automatic). `signup` and `referral` already have
automatic award paths with their own idempotency (`awardedRules` includes `signup`;
referral uses the `loyalty_referred_by_credited` metafield). Excluding them means the
manual path's idempotency-by-handle can never collide with an auto path.

## Architecture

Four units plus targeted edits to two admin surfaces. The award math is pure and
unit-tested; the Shopify IO mirrors the existing `applyRedemptionForCustomer`.

```
src/domain/customer-state.ts          ← pure: projectManualAward (tested)
app/loyalty/constants.ts              ← MANUAL_EARN_ELIGIBLE_ACTIONS
app/loyalty/customer-state.server.ts  ← awardEarnRuleToCustomer (IO)
app/loyalty/earn-rules-redemptions-admin.server.ts ← repeatable field on rule
app/components/loyalty-admin-ui.tsx   ← Repeatable toggle + corrected help text
app/routes/app.customers.tsx          ← Award-points control + action intent
```

### Unit 1 — `repeatable` flag on earn rules

The earn-rule metaobject gains a boolean field `repeatable` (default `false`).

- **Metaobject definition:** add a `boolean` field `repeatable` to the earn-rule
  definition, created/updated in the existing `ensureLoyaltyDefinitions` flow
  (`admin.server.ts`). Adding a field to an existing definition is non-destructive;
  existing rules read it as absent → treated as `false`.
- **Types:** `LoyaltyEarnRuleEditorEntry` gets `repeatable: string` (`'true'`/`'false'`
  for the form, matching the existing `active` field convention);
  `LoyaltyEarnRuleInput` gets `repeatable: boolean`.
- **Persistence:** `applyEarnRuleEntries` writes a `repeatable` field
  (`value: rule.repeatable ? 'true' : 'false'`) alongside the existing `active`
  field. `buildEarnRuleEditorEntries` and the sanitizer parse it (default `false`
  when missing).
- **Program read:** `LoyaltyEarnRuleConfig` (in `src/domain/program.ts`) gains
  `repeatable: boolean`, populated when the snapshot is built so the award path can
  read it.

### Unit 2 — `MANUAL_EARN_ELIGIBLE_ACTIONS` constant

In `app/loyalty/constants.ts`:

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

### Unit 3 — `projectManualAward` (pure, unit-tested)

In `src/domain/customer-state.ts`:

```ts
export type ManualAwardRule = {
  handle: string;
  action: string;
  pointsValue: number | null;
  active: boolean;
  repeatable: boolean;
};

export type ManualAwardResult = {
  status: 'awarded' | 'already_awarded' | 'rejected';
  reason?: string;            // populated when rejected
  newBalance: number;         // unchanged on already_awarded/rejected
  pointsAwarded: number;      // 0 unless awarded
  newAwardedRules: string[];  // unchanged unless a one-time rule was awarded
};

export function projectManualAward({
  rule,
  currentBalance,
  awardedRules,
}: {
  rule: ManualAwardRule;
  currentBalance: number;
  awardedRules: string[];
}): ManualAwardResult;
```

Logic:
1. If `!rule.active` → `rejected`, reason `"Rule is inactive"`.
2. If `rule.pointsValue` is null or `<= 0` → `rejected`, reason
   `"Rule has no positive points value"`.
3. If `!rule.repeatable && awardedRules.includes(rule.handle)` →
   `already_awarded` (no balance change).
4. Otherwise → `awarded`: `newBalance = currentBalance + rule.pointsValue`,
   `pointsAwarded = rule.pointsValue`, and `newAwardedRules = rule.repeatable ?
   awardedRules : [...new Set([...awardedRules, rule.handle])]`.

(Manual eligibility by *action* is enforced at the call site / UI, not here — this
function is purely about balance + idempotency. Keeps the pure unit focused.)

### Unit 4 — `awardEarnRuleToCustomer` (Shopify IO)

In `app/loyalty/customer-state.server.ts`, mirroring `applyRedemptionForCustomer`:

```ts
export async function awardEarnRuleToCustomer({
  admin,
  customerAdminId,
  ruleHandle,
}: {
  admin: AdminApiContext;
  customerAdminId: string;
  ruleHandle: string;
}): Promise<{status: 'awarded' | 'already_awarded' | 'rejected'; message: string}>;
```

Flow:
1. Fetch the program config and the customer's points state
   (`fetchCustomerPointsState` → balance + `awardedRules`).
2. Find the active earn rule by `ruleHandle`. If not found / not active /
   `!isManualEarnEligible(rule.action)` → return `rejected` with a clear message
   (no write).
3. Call `projectManualAward({rule, currentBalance, awardedRules})`.
4. On `awarded`: write the updated points-balance metafield and the `loyalty_state`
   metafield (with `newAwardedRules` and refreshed `computedAt`) using the same
   `metafieldsSet` pattern as `applyRedemptionForCustomer`. Tier state is unchanged
   (tiers are spend-based, not points-based), so we only update balance + awardedRules
   + computedAt.
5. On `already_awarded` / `rejected`: no write; return the status + message.

GraphQL/network failures throw and are captured via `Sentry.captureException`,
consistent with the other award paths.

### Unit 5 — Admin UI

**Earn-rule editor (`app/components/loyalty-admin-ui.tsx`):**
- Add a "Repeatable" toggle to each earn-rule row, bound to the new `repeatable`
  editor field (same control style as the existing "Active" toggle).
- Fix the misleading copy. The action `<select>` help text and
  `admin.server.ts:201` description currently imply all actions auto-award. Reword to:
  *"`order`, `signup`, and `referral` award points automatically. Other actions
  (birthday, review, newsletter, social follows, custom) are awarded manually from
  the Customers page."*

**Customers page (`app/routes/app.customers.tsx`):**
- Each customer row gets an **Award points** control: a `<select>` of active
  manual-eligible earn rules (title + points) and an **Award** button.
- Submitting posts a new action `intent: 'awardEarnRule'` with `customerId` and
  `ruleHandle`. The route action calls `awardEarnRuleToCustomer` and returns the
  status/message.
- Result is shown via the page's existing fetcher/toast pattern: `awarded` →
  success ("Awarded N points"), `already_awarded` → info, `rejected` → error.
- The list of manual-eligible rules is supplied by the loader (filter the program's
  earn rules by `active && isManualEarnEligible(action)`).

## Data flow

```
Merchant picks rule + clicks Award (Customers page)
  └─▶ app.customers action (intent: awardEarnRule)
        └─▶ awardEarnRuleToCustomer({admin, customerAdminId, ruleHandle})
              ├─ fetchCustomerPointsState  (balance + awardedRules)
              ├─ find active rule by handle; isManualEarnEligible(action)?
              │     └─ no ─▶ rejected (no write)
              ├─ projectManualAward(rule, balance, awardedRules)  [pure]
              │     ├─ already_awarded ─▶ no write
              │     ├─ rejected         ─▶ no write
              │     └─ awarded ─▶ write balance + loyalty_state metafields
              └─ return {status, message} ─▶ toast
```

## Error handling

| Case | Behavior |
|------|----------|
| Rule not found / inactive / not manual-eligible | `rejected`, error toast, no write |
| `pointsValue` null or ≤ 0 | `rejected`, error toast, no write |
| One-time rule already in `awardedRules` | `already_awarded`, info toast, no write |
| GraphQL/network failure | throw + `Sentry.captureException`, generic error toast |

No partial writes: the balance and `loyalty_state` metafields are written only on
the `awarded` path, after the pure projection succeeds.

## Testing

**Unit — `src/__tests__/domain/manual-award.test.ts`** (pure `projectManualAward`):
- Awards `pointsValue` to balance for an active, eligible, not-yet-awarded rule.
- One-time rule already in `awardedRules` → `already_awarded`, balance unchanged.
- Repeatable rule already in `awardedRules` → awards again, balance increases,
  `awardedRules` unchanged.
- `pointsValue` null → `rejected`; `pointsValue` 0 or negative → `rejected`.
- Inactive rule → `rejected`.
- One-time award appends the handle to `newAwardedRules` (deduped); repeatable does not.

**Unit — eligibility:** `isManualEarnEligible` returns true for the 6 manual actions,
false for `order`/`signup`/`referral`.

**Manual / review-store:** award a `review` rule to a customer from the Customers
page → balance increases by the rule's points, toast confirms; awarding a one-time
rule twice → second attempt shows "already awarded"; a `repeatable` rule can be
awarded repeatedly.

## Files touched

| File | Change |
|------|--------|
| `src/domain/customer-state.ts` | **new** `projectManualAward` + types |
| `src/domain/program.ts` | `repeatable` on `LoyaltyEarnRuleConfig` |
| `src/__tests__/domain/manual-award.test.ts` | **new** unit tests |
| `app/loyalty/constants.ts` | `MANUAL_EARN_ELIGIBLE_ACTIONS` + `isManualEarnEligible` |
| `app/loyalty/customer-state.server.ts` | **new** `awardEarnRuleToCustomer` |
| `app/loyalty/earn-rules-redemptions-admin.server.ts` | `repeatable` field: types, persist, build, sanitize |
| `app/loyalty/admin.server.ts` | add `repeatable` field to earn-rule metaobject definition; fix help-text string |
| `app/components/loyalty-admin-ui.tsx` | Repeatable toggle + corrected action help text |
| `app/routes/app.customers.tsx` | loader exposes manual-eligible rules; Award control + `awardEarnRule` action |

## Follow-ups (not in this build)

1. **Listing copy:** once shipped, honestly re-add "award points for reviews, social
   follows, birthdays and custom actions" to `STORE_LISTING.md`.
2. Automatic triggers (newsletter via `customers/update` marketing consent; birthday
   scheduler) — separate spec if desired.
3. Authenticated award API for Shopify Flow / Zapier — separate spec if desired.
