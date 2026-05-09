# Earn Rules and Redemptions

Foundation work added on `feat/loyalty-engine-metafield-read`. The engine now
recognises two new Shopify metaobject types alongside the existing
`loyalty_reward_tier` and `loyalty_reward_benefit`.

## Why

The pre-existing program is *tier-only* — automatic % discount at checkout
based on lifetime spend. To match a Royal Codes-class loyalty program we need
two more concepts:

- **Earn rules** — actions that award points (sign up, place an order, leave a
  review, refer a friend, follow on social, birthday, …).
- **Redemptions** — what customers can spend points on (fixed-amount
  discount, % off, free shipping, free product, early access, …).

These are merchant-editable from Shopify Admin → Settings → Custom data →
Metaobjects, so the brand can change copy/values without a deploy.

## Schema

### `loyalty_earn_rule`

| Field          | Type               | Required | Notes                                              |
| -------------- | ------------------ | -------- | -------------------------------------------------- |
| `handle`       | single-line text   | yes      | Stable machine ID (e.g. `signup`, `order`)         |
| `title`        | single-line text   | yes      | Storefront label                                   |
| `description`  | multi-line text    | no       | Subtitle shown on rewards page                     |
| `action`       | single-line text   | yes      | One of the action codes below                      |
| `points_value` | number_integer     | no       | Points awarded; omit for dynamic (e.g. 1pt/$1)     |
| `active`       | boolean            | no       | Default `true`. Inactive rules are hidden          |

**Recognised `action` codes:** `signup`, `order`, `birthday`,
`follow_instagram`, `follow_tiktok`, `review`, `referral`, `newsletter`,
`custom`. Unknown codes are surfaced verbatim on the storefront and ignored by
the points-awarding worker.

### `loyalty_redemption`

| Field          | Type               | Required | Notes                                              |
| -------------- | ------------------ | -------- | -------------------------------------------------- |
| `handle`       | single-line text   | yes      | Stable machine ID                                  |
| `title`        | single-line text   | yes      | Storefront label                                   |
| `description`  | multi-line text    | no       | Subtitle                                           |
| `points_cost`  | number_integer     | yes      | Points required to redeem                          |
| `reward_type`  | single-line text   | yes      | See list below                                     |
| `reward_value` | single-line text   | no       | E.g. `10` for $10 off, `15` for 15% off            |
| `active`       | boolean            | no       | Default `true`                                     |

**Recognised `reward_type` codes:** `fixed_discount`, `percent_discount`,
`free_shipping`, `free_product`, `early_access`. The discount function
extension currently knows how to apply `fixed_discount`, `percent_discount`,
and `free_shipping`. The other two are storefront-only metadata until the
extension is extended.

## Read path

```
apps/loyalty-engine/app/loyalty/earn-rules-redemptions.server.ts
  └── fetchEarnRules(admin)    → EngineEarnRule[]
  └── fetchRedemptions(admin)  → EngineRedemption[]
```

Both helpers query the metaobjects via `adminGraphql` and normalise the field
shape. They return `[]` when the merchant hasn't set anything up yet — the
storefront uses `DEFAULT_LOYALTY_EARN_RULES` and `DEFAULT_LOYALTY_REDEMPTIONS`
from `app/lib/loyalty.ts` as a display fallback.

## Storefront contract

When the engine starts publishing earn rules + redemptions into the shop
metafield `$app.loyalty_program_snapshot`, extend the JSON shape to:

```jsonc
{
  "program": { "currencyCode": "USD", "tiers": [ ... ] },
  "earnRules": [ /* EngineEarnRule[] */ ],
  "redemptions": [ /* EngineRedemption[] */ ],
  "discountConfiguration": { ... }
}
```

The Hydrogen storefront reads `program.earnRules` and `program.redemptions`
from `LoyaltyProgram` (see `app/lib/loyalty.ts`); both fields are optional, so
publishing the new shape is non-breaking — clients fall back to the bundled
defaults until the snapshot includes them.

## Outstanding work (tracked separately)

1. Wire `fetchEarnRules` / `fetchRedemptions` into
   `fetchLoyaltyProgramConfiguration` and persist them into the program
   snapshot metafield.
2. Extend `webhooks.metaobjects.tsx` filter to include `loyalty_earn_rule` and
   `loyalty_redemption` so updates trigger a resync.
3. Add admin UI in `app._index.tsx` (Polaris) to author earn rules + redemptions
   without leaving the app.
4. Implement points awarding in the `orders/paid` webhook based on the `order`
   earn rule and any other rules with one-shot triggers (signup, birthday).
5. Extend the discount function extension to apply
   redemption-type discounts when a customer redeems points.
