# Points History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every points change in a Postgres `PointsEvent` table, from the first order after go-live.

**Architecture:** One helper, `recordPointsEvents(shop, events)`, called after each successful `saveLoyaltyCustomer`. It never throws. Spec: `docs/superpowers/specs/2026-10-01-points-history-design.md`.

**Tech Stack:** Prisma 6 + Postgres (Cloud SQL), React Router 7 routes, Vitest.

## Global Constraints

- History save failures are logged with `console.error` and never thrown (no webhook retry, no double points).
- Rows are written only after the balance write succeeded.
- Skip zero-point rows, except `reward_used`.
- Event types: `order`, `signup`, `referral`, `refund`, `redeem`, `reward_used`, `manual`.
- Run tests with `npx vitest run`; typecheck with `npm run typecheck`; lint with `npm run lint`.

---

### Task 1: Table and `recordPointsEvents`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261001120000_points_event/migration.sql` (generated with `prisma migrate diff`)
- Create: `app/loyalty/points-history.server.ts`
- Modify: `src/__tests__/helpers/fakes.ts` (`memoryPrisma` gets `pointsEvent.createMany` and `events`)
- Test: `src/__tests__/loyalty/points-history.test.ts`

**Produces:** `PointsEventInput` type, `recordPointsEvents(shop: string, events: PointsEventInput[]): Promise<void>`, and `memoryPrisma().events` (array of written rows).

- [ ] Step 1: Write a failing test. `recordPointsEvents` writes rows with the shop, and it resolves (logs) when `createMany` rejects.
- [ ] Step 2: Run `npx vitest run src/__tests__/loyalty/points-history.test.ts`. Expect FAIL (module missing).
- [ ] Step 3: Add the model, generate the migration SQL from the schema diff, and write the helper:

```ts
export async function recordPointsEvents(shop: string, events: PointsEventInput[]) {
  if (events.length === 0) return;
  try {
    await prisma.pointsEvent.createMany({data: events.map((event) => ({shop, ...event}))});
  } catch (error) {
    console.error(`[loyalty] Could not save points history for ${shop}`, JSON.stringify(events));
    console.error(error);
  }
}
```

- [ ] Step 4: Run the test again. Expect PASS.
- [ ] Step 5: Commit.

### Task 2: `projectPaidOrder` breakdown

**Files:** Modify `src/domain/customer-state.ts`; Test `src/__tests__/domain/loyalty-events.test.ts`

**Produces:** `projectPaidOrder(...).earned: Array<{type: 'order' | 'signup' | 'referral'; points: number}>`, which skips zero-point parts. The parts sum to `balance − customer.balance`.

- [ ] Step 1: Write a failing test. A first order of $120.50 with a referrer gives `earned` = `[{order,120},{signup,200},{referral,500}]`.
- [ ] Step 2: Run it. Expect FAIL.
- [ ] Step 3: Build `earned` alongside `points` in `projectPaidOrder`.
- [ ] Step 4: Run it. Expect PASS.
- [ ] Step 5: Commit.

### Task 3: orders/paid records history

**Files:** Modify `app/routes/webhooks.orders-paid.tsx`; Test `src/__tests__/webhooks/orders-paid-route.test.ts`

**Consumes:** `recordPointsEvents`, `earned`.

- [ ] Step 1: Write failing tests:
  - A first order records `order` and `signup` rows, each with a running balance and the order ID.
  - A referral records a `referral` row for the referrer.
  - Using the reward code records `reward_used` with the code.
  - When `createMany` rejects, the response is still 200, there is exactly one balance write, and the claim key is kept.
- [ ] Step 2: Run. Expect FAIL.
- [ ] Step 3: After `saveLoyaltyCustomer`, build the rows (running balance from `customer.balance`) and call `recordPointsEvents(shop, rows)`.
- [ ] Step 4: Run. Expect PASS.
- [ ] Step 5: Commit.

### Task 4: refunds/create records history

**Files:** Modify `app/routes/webhooks.orders-refunded.tsx`; Test `src/__tests__/webhooks/orders-refunded-route.test.ts`

- [ ] Step 1: Write a failing test. A refund of 41.94 against a balance of 100 records `{type:'refund', points:-41, balance:59, orderId, data:{refundId}}`.
- [ ] Step 2: Run. Expect FAIL.
- [ ] Step 3: Record `points: newBalance − customer.balance`. That is the amount actually taken, after the clamp at 0.
- [ ] Step 4: Run. Expect PASS.
- [ ] Step 5: Commit.

### Task 5: redeem records history

**Files:**
- Modify `app/loyalty/engine-auth.server.ts`: `resolveAdminContext` also returns `shop`.
- Modify `app/routes/api.redeem.tsx`.
- Test `src/__tests__/loyalty/redeem-route.test.ts`, and `redeem-idor.test.ts` (mock session storage, add shop).

- [ ] Step 1: Write a failing test. A successful redeem records `{type:'redeem', points:-500, balance:100, data:{handle,title,code,discountId,expiresAt}}`.
- [ ] Step 2: Run. Expect FAIL.
- [ ] Step 3: Return `shop` from both auth paths (the shared-secret header, or `session.shop`). Record after the save.
- [ ] Step 4: Run. Expect PASS.
- [ ] Step 5: Commit.

### Task 6: manual award records history

**Files:**
- Modify `app/loyalty/customer-state.server.ts`: `awardEarnRuleToCustomer` takes `shop`.
- Modify `app/routes/app.customers.tsx`: pass `session.shop`.
- Test `src/__tests__/loyalty/manual-award-route.test.ts`.

- [ ] Step 1: Write a failing test. Awarding the `birthday` rule records `{type:'manual', points, balance, data:{rule:'birthday', title}}`.
- [ ] Step 2: Run. Expect FAIL.
- [ ] Step 3: Add `shop` and record after the save.
- [ ] Step 4: Run. Expect PASS.
- [ ] Step 5: Commit.

### Task 7: Verify and ship

- [ ] Run `npx vitest run`, `npm run typecheck` and `npm run lint`. All must be green.
- [ ] Build in Cloud Build from a `git archive` upload. gcloud's own upload hangs on this network (HTTP/1.1 to GCS), so upload with curl.
- [ ] Deploy the image. Check that `/health` is OK and the startup log shows the `points_event` migration applied.
- [ ] Update `docs/superpowers/plans/2026-09-29-restart.md`.
