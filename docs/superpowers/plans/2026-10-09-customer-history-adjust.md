# Customer history and points adjust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer page in the admin that shows the customer's points timeline from `PointsEvent`, plus a form where staff add or remove points with their name and a reason.

**Architecture:** Pure logic goes in `src/domain/`: the plain wording per event type, and the balance projection for an adjustment. Server code goes in `app/loyalty/`: paging the history query, and `adjustCustomerPoints`, which follows the same load → project → `saveLoyaltyCustomer` → `recordPointsEvents` path as rule awards. One new route, `app/routes/app.customers_.$id.tsx` (the trailing `_` keeps it from nesting inside the list route), renders Polaris web components.

**Tech Stack:** React Router 7 (flat routes), Polaris web components (`s-*`), Prisma (Postgres), Shopify Admin GraphQL 2026-04, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-customer-history-adjust-design.md`

## Global Constraints

- Work in `/Users/naspadstudio/Documents/GitHub/amadaflow-apps/loyalty-engine` on branch `restart/private-app`.
- No new dependencies, no Prisma migration, no scope or TOML change, no `shopify app deploy`.
- New event type `adjust`; never reuse `manual` for staff corrections (piece B must not email about them).
- Every `PointsEvent` read filters on `shop = session.shop`.
- "Balance after" shows each row's stored `balance`, never a running sum.
- Adjust limits: points a whole number ≥ 1; "Your name" required, ≤ 60 chars; "Reason" required, ≤ 200 chars; never below 0.
- All new user-facing strings live in one object per file (`COPY` in the route, the switch in `points-event-copy.ts`) so the English + Indonesian slice only swaps them.
- Numbers display with `toLocaleString('en-US')`, matching `app.customers.tsx`.
- Tests: `npm test` (Vitest, `src/__tests__/**/*.test.ts`). Gates before each commit: `npm test`; before the route commit also `npm run typecheck` and `npm run lint`.
- Commit messages: `feat(loyalty-engine): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/domain/points-event-copy.ts` | create | `describePointsEvent`: plain wording + order number for one history row |
| `src/domain/customer-state.ts` | modify | add `projectAdjustment` (new balance, below-zero check) |
| `app/loyalty/points-history.server.ts` | modify | add `adjust` type, `historyPageArgs`, `listPointsEvents` |
| `app/loyalty/customer-state.server.ts` | modify | `StaleBalanceError` in `saveLoyaltyCustomer`, `AdjustOutcome`, `adjustCustomerPoints` |
| `src/integrations/shopify/admin-operations.ts` | modify | select `code` on `metafieldsSet.userErrors` |
| `app/routes/app.customers_.$id.tsx` | create | customer page: header, adjust form, history table |
| `app/routes/app.customers.tsx` | modify | customer name links to the new page |
| `src/__tests__/helpers/fakes.ts` | modify | `pointsEvent.findMany` on `memoryPrisma` |
| tests | create/modify | `src/__tests__/domain/points-event-copy.test.ts`, `src/__tests__/domain/adjustment.test.ts`, `src/__tests__/loyalty/points-history.test.ts`, `src/__tests__/loyalty/adjust-points.test.ts` |

---

### Task 1: Plain wording for history rows

**Files:**
- Create: `src/domain/points-event-copy.ts`
- Test: `src/__tests__/domain/points-event-copy.test.ts`
- Modify: `docs/superpowers/specs/2026-10-09-customer-history-adjust-design.md` (order link rule)

**Interfaces:**
- Produces: `describePointsEvent(event: {type: string; orderId: string | null; data: unknown}): {text: string; orderNumber: string | null}`. Task 5 calls it in the route loader.

- [ ] **Step 1: Write the failing test**

`src/__tests__/domain/points-event-copy.test.ts`:

```ts
import {describe, it, expect} from 'vitest';
import {describePointsEvent} from '../../domain/points-event-copy.js';

const row = (type: string, data: unknown = null, orderId: string | null = null) => ({type, data, orderId});

describe('describePointsEvent', () => {
  it.each([
    ['order', 'Earned from order'],
    ['signup', 'Sign-up bonus'],
    ['referral', 'Referral bonus'],
    ['refund', 'Taken back after a refund'],
  ])('describes %s rows', (type, text) => {
    expect(describePointsEvent(row(type)).text).toBe(text);
  });

  it('names the reward and code of a redeem', () => {
    expect(describePointsEvent(row('redeem', {title: '$10 off', code: 'LF-ABC123'})).text)
      .toBe('Redeemed for $10 off (code LF-ABC123)');
  });

  it('falls back when a redeem has no title', () => {
    expect(describePointsEvent(row('redeem', {})).text).toBe('Redeemed for a reward');
  });

  it('names the code of a used reward', () => {
    expect(describePointsEvent(row('reward_used', {code: 'LF-ABC123'})).text).toBe('Used reward code LF-ABC123');
    expect(describePointsEvent(row('reward_used')).text).toBe('Used a reward code');
  });

  it('names the rule of a manual award', () => {
    expect(describePointsEvent(row('manual', {title: 'Birthday'})).text).toBe('Awarded for Birthday');
    expect(describePointsEvent(row('manual')).text).toBe('Awarded points');
  });

  it('shows who adjusted and why', () => {
    expect(describePointsEvent(row('adjust', {staffName: 'Rina', reason: 'damaged parcel'})).text)
      .toBe('Adjusted by Rina: damaged parcel');
    expect(describePointsEvent(row('adjust', {})).text).toBe('Adjusted by staff');
  });

  it('has a fallback for unknown types', () => {
    expect(describePointsEvent(row('something_new')).text).toBe('Points changed');
  });

  it('returns the order number from the order GID', () => {
    expect(describePointsEvent(row('order', null, 'gid://shopify/Order/6209829119461')).orderNumber).toBe('6209829119461');
    expect(describePointsEvent(row('signup')).orderNumber).toBeNull();
    expect(describePointsEvent(row('order', null, 'not-a-gid')).orderNumber).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/__tests__/domain/points-event-copy.test.ts`
Expected: FAIL, because `../../domain/points-event-copy.js` can't be resolved.

- [ ] **Step 3: Implement**

`src/domain/points-event-copy.ts`:

```ts
/**
 * Plain wording for one points-history row, as staff see it on the customer
 * page. All English strings for history rows live here, so the
 * English + Indonesian slice only swaps this switch.
 */
export function describePointsEvent(event: {
  type: string;
  orderId: string | null;
  data: unknown;
}): {text: string; orderNumber: string | null} {
  const data = event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};
  const str = (key: string) => (typeof data[key] === 'string' && data[key] !== '' ? (data[key] as string) : null);
  const title = str('title');
  const code = str('code');

  let text: string;
  switch (event.type) {
    case 'order': text = 'Earned from order'; break;
    case 'signup': text = 'Sign-up bonus'; break;
    case 'referral': text = 'Referral bonus'; break;
    case 'refund': text = 'Taken back after a refund'; break;
    case 'redeem': text = title ? `Redeemed for ${title}${code ? ` (code ${code})` : ''}` : 'Redeemed for a reward'; break;
    case 'reward_used': text = code ? `Used reward code ${code}` : 'Used a reward code'; break;
    case 'manual': text = title ? `Awarded for ${title}` : 'Awarded points'; break;
    case 'adjust': {
      const reason = str('reason');
      text = `Adjusted by ${str('staffName') ?? 'staff'}${reason ? `: ${reason}` : ''}`;
      break;
    }
    default: text = 'Points changed';
  }

  const orderNumber = /^gid:\/\/shopify\/Order\/(\d+)$/.exec(event.orderId ?? '')?.[1] ?? null;
  return {text, orderNumber};
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/__tests__/domain/points-event-copy.test.ts`
Expected: PASS.

- [ ] **Step 5: Align the spec**

Signup and referral rows also carry `orderId`, so every row that has one gets the order link. In the spec's wording table, change the `order` row's "extra" cell to `link shopify://admin/orders/<n> when orderId is set (any type; no lookup, so the 60-day read_orders limit doesn't apply)`. Then clear the "order link when set" cells on the `refund` and `reward_used` rows.

- [ ] **Step 6: Commit**

```bash
git add src/domain/points-event-copy.ts src/__tests__/domain/points-event-copy.test.ts docs/superpowers/specs/2026-10-09-customer-history-adjust-design.md
git commit -m "feat(loyalty-engine): plain wording for points history rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Adjustment projection

**Files:**
- Modify: `src/domain/customer-state.ts` (add after `projectManualAward`)
- Test: `src/__tests__/domain/adjustment.test.ts`

**Interfaces:**
- Consumes: `LoyaltyCustomer` (existing).
- Produces, for Task 4:
  ```ts
  export type AdjustmentProjection =
    | {status: 'adjusted'; newBalance: number}
    | {status: 'below_zero'; balance: number};
  export function projectAdjustment(args: {customer: LoyaltyCustomer; delta: number}): AdjustmentProjection;
  ```
- No tier logic: `normalizeTierEntries` forces every tier to `lifetime_spend`, and the tier segments filter on `amount_spent` (`src/domain/discount-engine.ts`), so points never move a tier.

- [ ] **Step 1: Write the failing test**

`src/__tests__/domain/adjustment.test.ts`:

```ts
import {describe, it, expect} from 'vitest';
import {projectAdjustment, type LoyaltyCustomer} from '../../domain/customer-state.js';

const customer = (overrides: Partial<LoyaltyCustomer> = {}): LoyaltyCustomer => ({
  id: 'gid://shopify/Customer/1', balance: 300, balanceDigest: 'd', awardedRules: [], activeRedemption: null,
  referrerId: null, referralCredited: false, lifetimeSpend: 250, paidOrderCount: 3, currencyCode: 'USD',
  ...overrides,
});

describe('projectAdjustment', () => {
  it('adds points', () => {
    const r = projectAdjustment({customer: customer(), delta: 500});
    expect(r).toEqual({status: 'adjusted', newBalance: 800});
  });

  it('removes points down to exactly 0', () => {
    const r = projectAdjustment({customer: customer(), delta: -300});
    expect(r).toEqual({status: 'adjusted', newBalance: 0});
  });

  it('refuses to go below 0 and reports the current balance', () => {
    const r = projectAdjustment({customer: customer(), delta: -301});
    expect(r).toEqual({status: 'below_zero', balance: 300});
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/__tests__/domain/adjustment.test.ts`
Expected: FAIL with `projectAdjustment is not a function`.

- [ ] **Step 3: Implement**

In `src/domain/customer-state.ts`, after `projectManualAward`:

```ts
export type AdjustmentProjection =
  | {status: 'adjusted'; newBalance: number}
  | {status: 'below_zero'; balance: number};

/**
 * A staff adjustment: the new balance, or a refusal when it would go below 0.
 * ponytail: no tier check. Tiers are always lifetime_spend
 * (normalizeTierEntries), so points never move a tier; add one if tiers ever
 * use points_balance.
 */
export function projectAdjustment({
  customer,
  delta,
}: {
  customer: LoyaltyCustomer;
  delta: number;
}): AdjustmentProjection {
  const newBalance = customer.balance + delta;
  return newBalance < 0
    ? {status: 'below_zero', balance: customer.balance}
    : {status: 'adjusted', newBalance};
}
```

`LoyaltyCustomer` is declared further down the same file. A type reference before its declaration is fine in TS.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/__tests__/domain/adjustment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/customer-state.ts src/__tests__/domain/adjustment.test.ts
git commit -m "feat(loyalty-engine): projectAdjustment for staff point changes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: History page query

**Files:**
- Modify: `app/loyalty/points-history.server.ts`
- Modify: `src/__tests__/helpers/fakes.ts` (`memoryPrisma`)
- Test: `src/__tests__/loyalty/points-history.test.ts` (append)
- Modify: `docs/superpowers/specs/2026-10-09-customer-history-adjust-design.md` (pagination bullet)

**Interfaces:**
- Produces:
  - `PointsEventType` gains `'adjust'`. Task 4 writes rows with this type.
  - For Task 5:
    ```ts
    export const HISTORY_PAGE_SIZE = 25;
    export function historyPageArgs(shop: string, customerId: string, after: string | null); // inferred shape, checked with `satisfies Prisma.PointsEventFindManyArgs`
    export async function listPointsEvents(shop: string, customerId: string, after: string | null): Promise<{rows: PointsEvent[]; nextCursor: string | null}>;
    ```
- Cursor format: `<createdAt ISO>_<id>`. This is keyset pagination. A malformed cursor gives the first page, and every query still filters on shop and customer, so a cursor taken from another customer can never show that customer's rows.

- [ ] **Step 1: Give the fake Prisma a `findMany`**

In `src/__tests__/helpers/fakes.ts`, inside `memoryPrisma()`'s `pointsEvent`, next to `createMany`:

```ts
      findMany: vi.fn(async (_args: unknown) => [] as Array<Record<string, unknown>>),
```

Tests set the rows with `prisma.pointsEvent.findMany.mockResolvedValueOnce([...])`.

- [ ] **Step 2: Write the failing tests**

Append to `src/__tests__/loyalty/points-history.test.ts`. Change the dynamic import line at the top to:

```ts
const {recordPointsEvents, historyPageArgs, listPointsEvents, HISTORY_PAGE_SIZE} = await import('../../../app/loyalty/points-history.server');
```

Then add:

```ts
describe('historyPageArgs', () => {
  it('reads the newest rows of one customer in one shop', () => {
    expect(historyPageArgs('test.myshopify.com', 'gid://shopify/Customer/1', null)).toEqual({
      where: {shop: 'test.myshopify.com', customerId: 'gid://shopify/Customer/1'},
      orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
      take: HISTORY_PAGE_SIZE + 1,
    });
  });

  it('continues after the cursor row, still inside the shop and customer', () => {
    const args = historyPageArgs('test.myshopify.com', 'gid://shopify/Customer/1', '2026-10-05T03:00:00.000Z_ck9');
    const at = new Date('2026-10-05T03:00:00.000Z');
    expect(args.where).toEqual({
      shop: 'test.myshopify.com',
      customerId: 'gid://shopify/Customer/1',
      OR: [{createdAt: {lt: at}}, {createdAt: at, id: {lt: 'ck9'}}],
    });
  });

  it('treats a malformed cursor as the first page', () => {
    expect(historyPageArgs('s', 'c', 'garbage').where).toEqual({shop: 's', customerId: 'c'});
    expect(historyPageArgs('s', 'c', 'not-a-date_ck9').where).toEqual({shop: 's', customerId: 'c'});
  });
});

describe('listPointsEvents', () => {
  const rows = (n: number) =>
    Array.from({length: n}, (_, i) => ({id: `ck${100 - i}`, createdAt: new Date(Date.UTC(2026, 9, 5, 0, 0, 100 - i))}));

  it('returns a cursor when there is another page', async () => {
    prisma.pointsEvent.findMany.mockResolvedValueOnce(rows(HISTORY_PAGE_SIZE + 1));
    const page = await listPointsEvents('s', 'c', null);
    expect(page.rows).toHaveLength(HISTORY_PAGE_SIZE);
    const last = page.rows.at(-1) as {id: string; createdAt: Date};
    expect(page.nextCursor).toBe(`${last.createdAt.toISOString()}_${last.id}`);
  });

  it('returns no cursor on the last page', async () => {
    prisma.pointsEvent.findMany.mockResolvedValueOnce(rows(3));
    const page = await listPointsEvents('s', 'c', null);
    expect(page.rows).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npx vitest run src/__tests__/loyalty/points-history.test.ts`
Expected: FAIL with `historyPageArgs is not a function`.

- [ ] **Step 4: Implement**

In `app/loyalty/points-history.server.ts`:

1. Add `| 'adjust'` to `PointsEventType`.
2. Change the type import to `import type {PointsEvent, Prisma} from '@prisma/client';`.
3. Append (`satisfies` rather than a return annotation, so `findMany` still infers `PointsEvent[]`):

```ts
export const HISTORY_PAGE_SIZE = 25;

/**
 * One page of a customer's history, newest first. The cursor is
 * `<createdAt ISO>_<id>` of the last row shown (keyset paging: the where
 * filter always applies, so a foreign cursor can't leak another customer's rows).
 */
export function historyPageArgs(
  shop: string,
  customerId: string,
  after: string | null,
) {
  const [iso, id] = after?.split('_') ?? [];
  const at = new Date(iso ?? '');
  const cursor = id && !Number.isNaN(at.getTime()) ? {at, id} : null;
  return {
    where: {
      shop,
      customerId,
      ...(cursor
        ? {OR: [{createdAt: {lt: cursor.at}}, {createdAt: cursor.at, id: {lt: cursor.id}}]}
        : {}),
    },
    orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
    take: HISTORY_PAGE_SIZE + 1,
  } satisfies Prisma.PointsEventFindManyArgs;
}

export async function listPointsEvents(
  shop: string,
  customerId: string,
  after: string | null,
): Promise<{rows: PointsEvent[]; nextCursor: string | null}> {
  const found = await prisma.pointsEvent.findMany(historyPageArgs(shop, customerId, after));
  const rows = found.slice(0, HISTORY_PAGE_SIZE);
  const last = rows.at(-1);
  return {
    rows,
    nextCursor: found.length > HISTORY_PAGE_SIZE && last ? `${last.createdAt.toISOString()}_${last.id}` : null,
  };
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx vitest run src/__tests__/loyalty/points-history.test.ts`
Expected: PASS. The existing `recordPointsEvents` tests still pass too.

- [ ] **Step 6: Align the spec**

In the spec's "Pagination" bullet, replace the Prisma-cursor text with: `?after=<createdAt ISO>_<id> keyset paging (createdAt < x, or createdAt = x and id < y); take 26 to know whether a "Next" link is needed; a malformed cursor returns the first page; the shop and customer filter always applies.`

- [ ] **Step 7: Commit**

```bash
git add app/loyalty/points-history.server.ts src/__tests__/helpers/fakes.ts src/__tests__/loyalty/points-history.test.ts docs/superpowers/specs/2026-10-09-customer-history-adjust-design.md
git commit -m "feat(loyalty-engine): page through a customer's points history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `adjustCustomerPoints` and stale-write detection

**Files:**
- Modify: `src/integrations/shopify/admin-operations.ts` (`METAFIELDS_SET_MUTATION`, `userErrors` selection, around line 23)
- Modify: `app/loyalty/customer-state.server.ts` (type `MetafieldsSetMutationData` at line 23; `saveLoyaltyCustomer` around line 260; new code at the end)
- Test: `src/__tests__/loyalty/adjust-points.test.ts`

**Interfaces:**
- Consumes: `projectAdjustment` (Task 2), `PointsEventType` `'adjust'` (Task 3), `loadLoyaltyCustomer`, `saveLoyaltyCustomer`, `recordPointsEvents` (existing).
- Produces, for Task 5:
  ```ts
  export class StaleBalanceError extends Error {}
  export type AdjustOutcome =
    | {status: 'adjusted'; delta: number; balance: number}
    | {status: 'invalid'}
    | {status: 'no_program'}
    | {status: 'not_found'}
    | {status: 'below_zero'; balance: number}
    | {status: 'conflict'}
    | {status: 'failed'};
  export async function adjustCustomerPoints(args: {
    admin: AdminApiContext; shop: string; customerAdminId: string; program: LoyaltyProgramConfig;
    delta: number; staffName: string; reason: string; staffUserId: string | null;
  }): Promise<AdjustOutcome>;
  ```
  The route builds the messages from these, so they stay translatable. `no_program` is only ever returned by the route.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/loyalty/adjust-points.test.ts`:

```ts
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {customerResponse, fakeAdmin, field, memoryPrisma, okWrite, testProgram} from '../helpers/fakes.js';

const prisma = memoryPrisma();
vi.mock('../../../app/session-storage.server', () => ({prisma}));

const {adjustCustomerPoints} = await import('../../../app/loyalty/customer-state.server');

const base = {
  shop: 'test.myshopify.com',
  customerAdminId: 'gid://shopify/Customer/1',
  program: testProgram,
  staffName: ' Rina ',
  reason: ' damaged parcel ',
  staffUserId: '74839201',
};

describe('adjustCustomerPoints', () => {
  beforeEach(() => {
    prisma.events.length = 0;
  });

  it('adds points, saves the balance and records an adjust row', async () => {
    const shopify = fakeAdmin({LoyaltyCustomer: () => customerResponse({balance: 250}), LoyaltyMetafieldsSet: okWrite});

    const result = await adjustCustomerPoints({...base, admin: shopify.admin as never, delta: 500});

    expect(result).toEqual({status: 'adjusted', delta: 500, balance: 750});
    expect(field(shopify.writes()[0], 'loyalty_points_balance')).toMatchObject({value: '750', compareDigest: 'digest-1'});
    expect(prisma.events).toEqual([{
      shop: 'test.myshopify.com', customerId: 'gid://shopify/Customer/1', type: 'adjust', points: 500, balance: 750,
      data: {reason: 'damaged parcel', staffName: 'Rina', staffUserId: '74839201'},
    }]);
  });

  it('refuses to remove more than the balance and writes nothing', async () => {
    const shopify = fakeAdmin({LoyaltyCustomer: () => customerResponse({balance: 300})});

    const result = await adjustCustomerPoints({...base, admin: shopify.admin as never, delta: -301});

    expect(result).toEqual({status: 'below_zero', balance: 300});
    expect(shopify.writes()).toEqual([]);
    expect(prisma.events).toEqual([]);
  });

  it.each([
    ['zero points', {delta: 0}],
    ['a fraction', {delta: 1.5}],
    ['no number', {delta: Number.NaN}],
    ['a blank name', {staffName: '  '}],
    ['a blank reason', {reason: ''}],
    ['a long name', {staffName: 'x'.repeat(61)}],
    ['a long reason', {reason: 'x'.repeat(201)}],
  ])('rejects %s without calling Shopify', async (_label, overrides) => {
    const shopify = fakeAdmin({});
    const result = await adjustCustomerPoints({...base, admin: shopify.admin as never, delta: 10, ...overrides});
    expect(result).toEqual({status: 'invalid'});
    expect(shopify.calls).toEqual([]);
  });

  it('reports a conflict when the balance changed since it was read', async () => {
    const shopify = fakeAdmin({
      LoyaltyCustomer: () => customerResponse({balance: 250}),
      LoyaltyMetafieldsSet: () => ({metafieldsSet: {metafields: [], userErrors: [
        {field: ['metafields', '1'], message: 'The metafield has been modified since it was loaded.', code: 'STALE_OBJECT'},
      ]}}),
    });

    const result = await adjustCustomerPoints({...base, admin: shopify.admin as never, delta: 10});

    expect(result).toEqual({status: 'conflict'});
    expect(prisma.events).toEqual([]);
  });

  it('reports not_found for an unknown customer', async () => {
    const shopify = fakeAdmin({LoyaltyCustomer: () => ({customer: null})});
    const result = await adjustCustomerPoints({...base, admin: shopify.admin as never, delta: 10});
    expect(result).toEqual({status: 'not_found'});
  });

  it('logs and reports failed when Shopify errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const shopify = fakeAdmin({LoyaltyCustomer: () => { throw new Error('boom'); }});

    const result = await adjustCustomerPoints({...base, admin: shopify.admin as never, delta: 10});

    expect(result).toEqual({status: 'failed'});
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run src/__tests__/loyalty/adjust-points.test.ts`
Expected: FAIL with `adjustCustomerPoints is not a function`.

- [ ] **Step 3: Ask Shopify for the error code**

In `src/integrations/shopify/admin-operations.ts`, `METAFIELDS_SET_MUTATION`: change

```graphql
      userErrors {
        field
        message
      }
```

to

```graphql
      userErrors {
        field
        message
        code
      }
```

(Validated against Admin API 2026-04. `STALE_OBJECT` is the code Shopify returns when the `compareDigest` doesn't match.)

In `app/loyalty/customer-state.server.ts`, add `code?: string | null;` to the `userErrors` item type in `MetafieldsSetMutationData` (line 23).

- [ ] **Step 4: Throw `StaleBalanceError` from `saveLoyaltyCustomer`**

In `app/loyalty/customer-state.server.ts`, above `saveLoyaltyCustomer`:

```ts
/** Shopify rejected a write because the balance changed after it was read. */
export class StaleBalanceError extends Error {
  constructor() {
    super('Customer points changed since they were read');
  }
}
```

In `saveLoyaltyCustomer`, directly before `assertNoUserErrors(result.metafieldsSet.userErrors, …)`:

```ts
  if (result.metafieldsSet.userErrors.some((error) => error.code === 'STALE_OBJECT')) {
    throw new StaleBalanceError();
  }
```

Webhook callers still see a throw, as they did before. Only the type is new.

- [ ] **Step 5: Implement `adjustCustomerPoints`**

In `app/loyalty/customer-state.server.ts`, add `projectAdjustment` to the existing import from `'../../src/domain/customer-state.js'`. Then append:

```ts
export type AdjustOutcome =
  | {status: 'adjusted'; delta: number; balance: number}
  | {status: 'invalid'}
  | {status: 'no_program'}
  | {status: 'not_found'}
  | {status: 'below_zero'; balance: number}
  | {status: 'conflict'}
  | {status: 'failed'};

/**
 * Staff add or remove points by hand from the customer page. Recorded as an
 * `adjust` row (not `manual`, which is rule awards) so piece B never emails a
 * customer about a correction.
 */
export async function adjustCustomerPoints({
  admin,
  shop,
  customerAdminId,
  program,
  delta,
  staffName,
  reason,
  staffUserId,
}: {
  admin: AdminApiContext;
  shop: string;
  customerAdminId: string;
  program: LoyaltyProgramConfig;
  delta: number;
  staffName: string;
  reason: string;
  staffUserId: string | null;
}): Promise<AdjustOutcome> {
  const name = staffName.trim();
  const why = reason.trim();
  if (!Number.isInteger(delta) || delta === 0 || !name || name.length > 60 || !why || why.length > 200) {
    return {status: 'invalid'};
  }

  try {
    const customer = await loadLoyaltyCustomer(admin, customerAdminId);
    if (!customer) return {status: 'not_found'};

    const projection = projectAdjustment({customer, delta});
    if (projection.status === 'below_zero') return projection;

    await saveLoyaltyCustomer(admin, {program, customer, balance: projection.newBalance});
    await recordPointsEvents(shop, [{
      customerId: customer.id,
      type: 'adjust',
      points: delta,
      balance: projection.newBalance,
      data: {reason: why, staffName: name, staffUserId},
    }]);

    return {status: 'adjusted', delta, balance: projection.newBalance};
  } catch (error) {
    if (error instanceof StaleBalanceError) return {status: 'conflict'};
    console.error(error);
    return {status: 'failed'};
  }
}
```

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: PASS. That's the new adjust tests plus all existing ones, including the orders-paid, refunded and redeem route tests that go through `saveLoyaltyCustomer`.

- [ ] **Step 7: Commit**

```bash
git add src/integrations/shopify/admin-operations.ts app/loyalty/customer-state.server.ts src/__tests__/loyalty/adjust-points.test.ts
git commit -m "feat(loyalty-engine): adjustCustomerPoints with stale-write detection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Customer page and list link

**Files:**
- Create: `app/routes/app.customers_.$id.tsx`
- Modify: `app/routes/app.customers.tsx` (name cell, around line 170)

**Interfaces:**
- Consumes:
  - `describePointsEvent` (Task 1)
  - `listPointsEvents` (Task 3)
  - `adjustCustomerPoints` and `AdjustOutcome` (Task 4)
  - `fetchLoyaltyProgramConfiguration(admin)` from `app/loyalty/program.server.ts`, which returns `{syncPlan: {program: LoyaltyProgramConfig | null}, …}`
  - `adminGraphql`
  - `authenticate.admin(request)`, which returns `{admin, session, sessionToken}`; `sessionToken.sub` is the staff user ID.
- Produces: the route `/app/customers/:id`, where `id` is the numeric customer ID.

The markup and the header query below were validated: Polaris App Home v1.0 and Admin API 2026-04.

- [ ] **Step 1: Create the route**

`app/routes/app.customers_.$id.tsx`:

```tsx
import {useEffect, useRef, useState, type FormEvent} from 'react';
import type {ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs} from 'react-router';
import {Form, Link, useActionData, useLoaderData} from 'react-router';
import {boundary} from '@shopify/shopify-app-react-router/server';
import {describePointsEvent} from '../../src/domain/points-event-copy.js';
import {adjustCustomerPoints, type AdjustOutcome} from '../loyalty/customer-state.server';
import {adminGraphql} from '../loyalty/graphql.server';
import {listPointsEvents} from '../loyalty/points-history.server';
import {fetchLoyaltyProgramConfiguration} from '../loyalty/program.server';
import {authenticate} from '../shopify.server';

const STAFF_NAME_KEY = 'loyalty.staffName';

const fmt = (n: number) => n.toLocaleString('en-US');
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

// All strings on this page; the English + Indonesian slice swaps this object.
const COPY = {
  back: 'Customers',
  points: 'Points',
  tier: 'Tier',
  noTier: 'No tier',
  adjustHeading: 'Adjust points',
  adjustHelp: 'Add or remove points by hand. The customer sees the new balance right away.',
  direction: 'Add or remove',
  add: 'Add points',
  remove: 'Remove points',
  amount: 'Points',
  staffName: 'Your name',
  reason: 'Reason',
  save: 'Save',
  historyHeading: 'Points history',
  empty: 'No points activity yet.',
  columns: {date: 'Date', what: 'What happened', points: 'Points', balance: 'Balance after'},
  viewOrder: 'View order',
  newest: 'Newest',
  older: 'Older',
  outcome(outcome: AdjustOutcome): string {
    switch (outcome.status) {
      case 'adjusted':
        return `${outcome.delta > 0 ? 'Added' : 'Removed'} ${fmt(Math.abs(outcome.delta))} points. Balance: ${fmt(outcome.balance)}.`;
      case 'below_zero':
        return `They have ${fmt(outcome.balance)} points. You can remove up to ${fmt(outcome.balance)}.`;
      case 'invalid':
        return 'Enter a whole number of points (1 or more), your name and a reason.';
      case 'no_program':
        return 'Initialize the program first.';
      case 'not_found':
        return 'Customer not found.';
      case 'conflict':
        return 'Their points changed while you were editing. Reload and try again.';
      case 'failed':
        return 'Could not change points right now. Please try again.';
    }
  },
};

const CUSTOMER_HEADER_QUERY = `#graphql
  query LoyaltyCustomerHeader($id: ID!) {
    shop {
      ianaTimezone
    }
    customer(id: $id) {
      id
      displayName
      defaultEmailAddress {
        emailAddress
      }
      balance: metafield(namespace: "$app", key: "loyalty_points_balance") {
        value
      }
      state: metafield(namespace: "$app", key: "loyalty_state") {
        value
      }
    }
  }
` as const;

type CustomerHeaderData = {
  shop: {ianaTimezone: string};
  customer: {
    id: string;
    displayName: string;
    defaultEmailAddress: {emailAddress: string | null} | null;
    balance: {value: string | null} | null;
    state: {value: string | null} | null;
  } | null;
};

function toCustomerGid(id: string | undefined) {
  return id && /^\d+$/.test(id) ? `gid://shopify/Customer/${id}` : null;
}

function notFound(): never {
  throw new Response('Not found', {status: 404});
}

export const loader = async ({request, params}: LoaderFunctionArgs) => {
  const {admin, session} = await authenticate.admin(request);
  const customerId = toCustomerGid(params.id) ?? notFound();
  const after = new URL(request.url).searchParams.get('after');

  const [header, configuration, history] = await Promise.all([
    adminGraphql<CustomerHeaderData>(admin, CUSTOMER_HEADER_QUERY, {id: customerId}),
    fetchLoyaltyProgramConfiguration(admin),
    listPointsEvents(session.shop, customerId, after),
  ]);
  const customer = header.customer ?? notFound();

  let tierHandle: string | null = null;
  try {
    tierHandle = (JSON.parse(customer.state?.value ?? 'null') as {currentTierHandle?: string | null} | null)?.currentTierHandle ?? null;
  } catch {
    // unreadable state: show as no tier
  }
  const tier = configuration.syncPlan.program?.tiers.find((entry) => entry.handle === tierHandle)?.name ?? tierHandle;
  const balance = Number.parseInt(customer.balance?.value ?? '0', 10);
  const date = new Intl.DateTimeFormat('en-US', {dateStyle: 'medium', timeStyle: 'short', timeZone: header.shop.ianaTimezone});

  return {
    numericId: params.id as string,
    name: customer.displayName,
    email: customer.defaultEmailAddress?.emailAddress ?? '—',
    balance: Number.isFinite(balance) ? balance : 0,
    tier,
    events: history.rows.map((row) => ({
      id: row.id,
      date: date.format(row.createdAt),
      points: row.points,
      balance: row.balance,
      ...describePointsEvent(row),
    })),
    nextCursor: history.nextCursor,
    isLaterPage: Boolean(after),
  };
};

export const action = async ({request, params}: ActionFunctionArgs) => {
  const {admin, session, sessionToken} = await authenticate.admin(request);
  const customerId = toCustomerGid(params.id) ?? notFound();
  const form = await request.formData();

  const program = (await fetchLoyaltyProgramConfiguration(admin)).syncPlan.program;
  if (!program) return {outcome: {status: 'no_program'} as AdjustOutcome};

  const points = Number(form.get('points'));
  const outcome = await adjustCustomerPoints({
    admin,
    shop: session.shop,
    customerAdminId: customerId,
    program,
    delta: form.get('direction') === 'remove' ? -points : points,
    staffName: String(form.get('staffName') ?? ''),
    reason: String(form.get('reason') ?? ''),
    staffUserId: sessionToken?.sub ? String(sessionToken.sub) : null,
  });
  return {outcome};
};

export default function CustomerRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const outcome = actionData?.outcome;
  const formRef = useRef<HTMLFormElement>(null);
  const [savedName, setSavedName] = useState('');

  useEffect(() => {
    try {
      setSavedName(localStorage.getItem(STAFF_NAME_KEY) ?? '');
    } catch {
      // storage blocked: the field just starts empty
    }
  }, []);

  // Clear the form after a successful change so a second click can't repeat it.
  useEffect(() => {
    if (actionData?.outcome.status === 'adjusted') formRef.current?.reset();
  }, [actionData]);

  const rememberName = (event: FormEvent<HTMLFormElement>) => {
    const name = new FormData(event.currentTarget).get('staffName');
    if (typeof name !== 'string' || !name.trim()) return;
    try {
      localStorage.setItem(STAFF_NAME_KEY, name.trim());
    } catch {
      // storage blocked: nothing to remember
    }
    setSavedName(name.trim());
  };

  return (
    <s-page heading={data.name}>
      <s-link slot="breadcrumb-actions" href="/app/customers">{COPY.back}</s-link>

      <s-section>
        <s-stack direction="inline" gap="large">
          <s-text>{data.email}</s-text>
          <s-text>{COPY.points}: <s-text type="strong">{fmt(data.balance)}</s-text></s-text>
          <s-text>{COPY.tier}: <s-text type="strong">{data.tier ?? COPY.noTier}</s-text></s-text>
        </s-stack>
      </s-section>

      <s-section heading={COPY.adjustHeading}>
        <s-paragraph>{COPY.adjustHelp}</s-paragraph>
        {outcome ? (
          <s-banner tone={outcome.status === 'adjusted' ? 'success' : 'critical'}>
            <s-paragraph>{COPY.outcome(outcome)}</s-paragraph>
          </s-banner>
        ) : null}
        <Form method="post" ref={formRef} onSubmit={rememberName}>
          <s-stack direction="block" gap="base">
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-select label={COPY.direction} name="direction">
                <s-option value="add">{COPY.add}</s-option>
                <s-option value="remove">{COPY.remove}</s-option>
              </s-select>
              <s-number-field label={COPY.amount} name="points" min={1} step={1} inputMode="numeric" required></s-number-field>
            </s-grid>
            <s-text-field key={savedName} label={COPY.staffName} name="staffName" defaultValue={savedName} maxLength={60} required></s-text-field>
            <s-text-area label={COPY.reason} name="reason" rows={2} maxLength={200} required></s-text-area>
            <s-button variant="primary" type="submit">{COPY.save}</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading={COPY.historyHeading}>
        {data.events.length === 0 ? (
          <s-paragraph>{COPY.empty}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>{COPY.columns.date}</s-table-header>
              <s-table-header listSlot="primary">{COPY.columns.what}</s-table-header>
              <s-table-header format="numeric">{COPY.columns.points}</s-table-header>
              <s-table-header format="numeric">{COPY.columns.balance}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.events.map((event) => (
                <s-table-row key={event.id}>
                  <s-table-cell>{event.date}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      <s-text>{event.text}</s-text>
                      {event.orderNumber ? (
                        <s-link href={`shopify://admin/orders/${event.orderNumber}`}>{COPY.viewOrder}</s-link>
                      ) : null}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{signed(event.points)}</s-table-cell>
                  <s-table-cell>{fmt(event.balance)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
        <s-stack direction="inline" gap="base">
          {data.isLaterPage ? (
            <Link to={`/app/customers/${data.numericId}`}>
              <s-button variant="secondary">{COPY.newest}</s-button>
            </Link>
          ) : null}
          {data.nextCursor ? (
            <Link to={`/app/customers/${data.numericId}?after=${encodeURIComponent(data.nextCursor)}`}>
              <s-button variant="secondary">{COPY.older}</s-button>
            </Link>
          ) : null}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

- [ ] **Step 2: Link names in the customers list**

In `app/routes/app.customers.tsx`, in the first `<s-table-cell>` of each row, replace

```tsx
                      <s-text type="strong">{row.name}</s-text>
```

with

```tsx
                      <Link to={`/app/customers/${row.id.split('/').pop()}`}>
                        <s-text type="strong">{row.name}</s-text>
                      </Link>
```

`Link` is already imported in that file.

- [ ] **Step 3: Typecheck, lint, test**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all three pass. If `typecheck` flags the `<s-text>` children typing or `ref` on `Form`, fix those to what the types allow. Don't add `any`.

- [ ] **Step 4: Manual check (runs in Task 6)**

Local dev can't run here: `.env` points `DATABASE_URL` at Postgres on `localhost`, and none is running. Cloud SQL is private-IP only. So this checklist runs in Task 6, on the **test store** after deploy. If a local Postgres is up (`pg_isready -h localhost` answers), you can run it now with `shopify app dev` and finish with `shopify app dev clean`.

Checklist:

1. Go to Customers and click a name. Check the page shows the name, email, points, tier and history table, or "No points activity yet."
2. Add 10 points with your name and reason "plan test". The banner reads "Added 10 points. Balance: …", the form clears, and the top history row reads "Adjusted by <name>: plan test" with "+10".
3. Reload. "Your name" is pre-filled.
4. Try to remove more than the balance. The "They have … points" banner appears, and no new row is added.
5. Remove the same 10 points again, so the test customer is back where they started.
6. For a customer with more than 25 rows (the test customer from Friday, if it has that many), "Older" pages back and "Newest" returns.
7. Click "View order" on an order row. It opens the order in Shopify admin.


- [ ] **Step 5: Commit**

```bash
git add app/routes/app.customers_.\$id.tsx app/routes/app.customers.tsx
git commit -m "feat(loyalty-engine): customer page with points history and adjust form

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Deploy and record

**Ask the user before this task.** It changes the live Cloud Run service that customers use.

- [ ] **Step 1: Deploy with the patch build**

Uploads to Cloud Storage hang from the office network, so deploy as the last few revisions did. Make a `git diff` patch from the source tarball already in `gs://run-sources-loyalty-engine-494212-asia-southeast1/manual/` to `HEAD`, then run a `--no-source` Cloud Build that applies it. The exact steps are in `docs/deploy-cloud-run.md` and the restart plan's Thursday night entry (revision `00006-m2j`). There's no migration, so start-up runs `prisma migrate deploy` with nothing to apply.

- [ ] **Step 2: Run Task 5's checklist on the test store**

The test store runs on the same Cloud Run service, but only the test store's data is touched. Fix anything that fails before going further.

- [ ] **Step 3: Smoke-check on the live store**

Open LoyaltyFlow → Customers → any customer. Check that the history shows real rows from Mon 5 Oct onwards. Don't adjust a real customer's points unless the owner asks.

- [ ] **Step 4: Record it**

In `docs/superpowers/plans/2026-09-29-restart.md`, mark the piece A parts 1–2 line done, with the commit and the revision. Then commit:

```bash
git add docs/superpowers/plans/2026-09-29-restart.md
git commit -m "docs(loyalty-engine): customer history and adjust deployed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
