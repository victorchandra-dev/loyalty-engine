# Customer history and points adjust (piece A, parts 1–2) — design

Approved 2026-10-09. First slice of piece A. Customers have been live since Mon
5 Oct, so staff need to answer "why do I have 749 points?" and fix balances.
Later slices: English + Indonesian (part 4), then the results page with shadcn
(part 3).

## 1. Customer page: `/app/customers/<numericId>`

Route `app/routes/app.customers.$id.tsx`. The path carries the numeric ID; the
loader rebuilds `gid://shopify/Customer/<id>` (a GID in a path segment breaks
routing). A non-numeric ID returns 404.

- **Customers list:** each name links to this page. The rule-based Award
  column stays as it is.
- **Header:** name, email, current balance, current tier. One small Admin
  query (`loadLoyaltyCustomer` has no name or email). Customer not found → 404.
- **Points timeline:** table *Date · What happened · Points · Balance after*,
  newest first, 25 rows per page.
  - Query: `PointsEvent` where `shop = session.shop` and
    `customerId = <gid>`, ordered `createdAt desc, id desc`, uses the
    `(shop, customerId, createdAt)` index.
  - Pagination: `?after=<rowId>` with Prisma `cursor: {id}, skip: 1`; take 26
    to know whether a "Next" link is needed. A cursor row from another shop or
    customer returns the first page (the `where` filter still applies).
  - "Balance after" is each row's stored `balance`, not a running sum, so test
    customers with balances from before history read correctly.
  - Empty: "No points activity yet."

Plain wording per type, from one pure function `describePointsEvent(event)`
in `src/domain/points-event-copy.ts`:

| type | text | extra |
|---|---|---|
| `order` | Earned from order | link `shopify://admin/orders/<n>` when `orderId` is set (no lookup, so the 60-day `read_orders` limit doesn't apply) |
| `signup` | Sign-up bonus | |
| `referral` | Referral bonus | |
| `refund` | Taken back after a refund | order link when set |
| `redeem` | Redeemed for `<data.title>` (code `<data.code>`) | falls back to "Redeemed for a reward" |
| `reward_used` | Used reward code `<data.code>` | order link when set |
| `manual` | Awarded for `<data.title>` | falls back to "Awarded points" |
| `adjust` | Adjusted by `<data.staffName>`: `<data.reason>` | |
| unknown | Points changed | |

All of the page's strings live in one `COPY` object in the route file (and the
table above in the copy module), so part 4 only swaps them.

## 2. Adjust form, on the same page

Fields: **Add / Remove** (choice), **Points** (whole number ≥ 1), **Your name**
(required, ≤ 60 chars, remembered in `localStorage` with try/catch), **Reason**
(required, ≤ 200 chars). Submitted as `intent=adjust`.

Server, `adjustCustomerPoints` in `app/loyalty/customer-state.server.ts`:

1. Validate input (trimmed name and reason non-empty, points integer ≥ 1).
   Invalid → plain message, no write.
2. `fetchLoyaltyProgramConfiguration`; program not initialised → the existing
   "Program not initialised" message.
3. `loadLoyaltyCustomer`; not found → "Customer not found."
4. `projectAdjustment({program, customer, delta})` in
   `src/domain/customer-state.ts` (pure): returns the new balance, or a
   rejection when the result would be below 0, plus the tier handle before and
   after (via `getCurrentTier` with the balance swapped in).
5. `saveLoyaltyCustomer` (compareDigest protection; `awardedRules` unchanged).
6. `recordPointsEvents` with `type: 'adjust'`, `points: delta`,
   `balance: newBalance`, `data: {reason, staffName, staffUserId}`, where
   `staffUserId` is `sessionToken.sub` from `authenticate.admin`. `adjust` is
   added to `PointsEventType`. No migration: `type` is a string column.

`adjust` is separate from `manual` (rule awards) so piece B never emails a
customer about a staff correction.

Messages:

| case | message |
|---|---|
| added | Added 500 points. Balance: 1,249. |
| removed | Removed 200 points. Balance: 549. |
| tier changed | …appended: Tier changed from Gold to Silver. (tier names, "no tier" when null) |
| below zero | They have 300 points. You can remove up to 300. |
| compareDigest conflict | Their points changed while you were editing. Reload and try again. |
| other failure | Could not change points right now. Please try again. (error logged with `console.error`) |

A tier can use `points_balance` as its metric, so an adjustment can move a
customer between tiers and change their checkout discount. The success message
says so; there is no extra confirm step.

An active reward code is not touched by an adjustment.

## Tests

Vitest, in `src/__tests__/domain/` next to the existing 106:

- `projectAdjustment`: add, remove, remove to exactly 0, below 0 rejected,
  tier change detected for a `points_balance` tier, no tier change for a
  `lifetime_spend` tier.
- `describePointsEvent`: every type, including missing `data` fields and an
  unknown type.

`npm run typecheck`, `npm run lint` and `npm test` pass.

## Deploy

The usual patch build (Cloud Build applies a `git diff` on top of the source
tarball in the bucket). No scope, TOML or schema change, so no
`shopify app deploy`.

## Not in this slice

Editing or deleting history rows, CSV export, search on the customers list,
English + Indonesian (part 4), results page (part 3).
