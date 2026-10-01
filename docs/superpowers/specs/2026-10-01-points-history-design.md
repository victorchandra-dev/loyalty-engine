# Points history (piece 0) — design

Approved 2026-10-01. Ships before the program is activated on Fri 2 Oct, so the
history is complete from the first order (everyone starts at 0).

## Why

The engine stores only each customer's current balance (Shopify metafields).
Staff can't answer "why do I have 749 points?", there is nothing to total for a
results page, and Klaviyo has nothing to send from. One append-only table fixes
all three; it is the shared foundation for piece A (admin UI) and piece B
(Klaviyo events).

## Data

Postgres table `PointsEvent`:

| column | meaning |
|---|---|
| `shop` | `*.myshopify.com` |
| `customerId` | Shopify customer GID |
| `type` | `order`, `signup`, `referral`, `refund`, `redeem`, `reward_used`, `manual` |
| `points` | change: `+87`, `-500`; `0` for `reward_used` |
| `balance` | balance after this row |
| `orderId` | order GID when there is one |
| `data` | JSON details: reward code/expiry/title, refund ID, rule, referee |
| `createdAt` | when it was recorded |

Indexed by `(shop, customerId, createdAt)` for a customer's history and
`(shop, createdAt)` for results.

## Where rows are written

Only after the Shopify balance write succeeded:

| Flow | Rows |
|---|---|
| orders/paid | `order` (+ order points), `signup` / `referral` bonus if earned, `reward_used` if the order used the reward code, `referral` for the referrer |
| refunds/create | `refund` (− points actually taken back) |
| POST /api/redeem | `redeem` (− cost; code, discount ID, expiry, title) |
| admin manual award | `manual` (+ points; rule handle and title) |

Zero-point rows are skipped (except `reward_used`). `projectPaidOrder` returns
the order/signup/referral parts so each gets its own row.

## Failure rule

Saving history never throws. A failure is logged with `console.error` (so the
"logged an error" alert fires) and the points change stands. Throwing inside
`runOnce` would release the claim and let Shopify's retry award the points
again; a missing history row is the lesser failure.

## Not in this piece

- `tier` rows and a "sent to Klaviyo" marker: piece B adds them; its migration
  marks existing rows as sent so nobody gets stale emails.
- Staff name and free-text reason on manual changes: piece A (new adjust form).
- Any UI that shows the history: piece A.
