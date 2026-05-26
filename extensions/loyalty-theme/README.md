# Loyalty theme extension (classic Liquid)

This theme app extension renders the loyalty program inside a **classic Liquid
storefront**. It ships two blocks:

- `loyalty-floating-widget.liquid` — a launcher button + popover.
- `loyalty-rewards.liquid` — an inline section block.

## Anonymous by design (audit M1)

These blocks are **intentionally anonymous**. They display **program-level
configuration only** — tiers, redemptions, and earn rules — fetched from the
engine's public endpoint:

```
GET {engine_url}/api/public-loyalty-program?shop={shop}.myshopify.com
```

They do **not** show per-customer data (points balance, current/next tier, XP).

### Why no personalized data here

A classic Liquid storefront has no signed customer-identity channel available to
a theme app extension. Shopify does not forward a verified `logged_in_customer_id`
to this JavaScript, and there is **no App Proxy** configured for this app. Without
a trustworthy customer identity, the engine cannot safely return per-customer
balances to the theme widget.

This was a deliberate decision: rather than build an App Proxy + HMAC-verified
customer route, the team scoped the Liquid surface to program config and routes
personalized data through surfaces that already have a verified customer:

- **New Customer Accounts UI extension** (`extensions/loyalty-customer-account`) —
  works on Liquid *and* Hydrogen stores; reads the customer's loyalty metafields
  over the Customer Account API.
- **Hydrogen storefront** (`app/components/LoyaltyFloatingWidget.tsx` in the main
  repo) — authenticates via the Customer Account API.

## Configuration (audit M3)

Each block requires a **Loyalty engine URL** setting (`engine_url`). There is no
hard-coded fallback host: if the setting is empty (or the shop domain cannot be
resolved), the widget **fails closed** — it logs a configuration error to the
console and shows "Rewards are currently unavailable." instead of calling a
guessed host. The shop domain is taken from `{{ shop.permanent_domain }}`.
