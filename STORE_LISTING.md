# Ama Da Flow Loyalty Engine — Shopify App Store Submission Checklist

Track readiness for Partner Dashboard submission. Check items off as completed.

## App configuration (`shopify.app.toml`)

- [x] `application_url` set (`https://amadaflow-loyalty.fly.dev`)
- [x] `auth.redirect_urls` populated
- [x] Business webhooks declared (`app/uninstalled`, `app/scopes_update`,
      `metaobjects/*`, `orders/paid`, `refunds/create`)
- [x] **Mandatory privacy/compliance webhooks declared** via
      `[webhooks.privacy_compliance]` — `customer_data_request_url`,
      `customer_deletion_url`, `shop_deletion_url`. (Handlers already existed in
      `app/routes/webhooks.customers.*.tsx` and `webhooks.shop.redact.tsx` but
      were not declared, so Shopify would not have delivered them.)
- [x] Scope justifications drafted (see "Scope justifications" section below). Paste
      into the API access / review-notes form at submission.

## Compliance / privacy

- [x] GDPR webhook handlers implemented (customers data request, customers redact,
      shop redact).
- [ ] **Privacy policy URL** — public page describing data handling (required field).
- [ ] Confirm customer metafields written by the app (`loyalty_state`,
      `loyalty_points_balance`, etc.) are covered by `customers/redact`.

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

## Listing content (Partner Dashboard)

- [x] App name, tagline, and description drafted (see "Listing copy" section below)
- [ ] App icon (1200×1200 PNG)
- [ ] Screenshots of the admin + customer-account loyalty UI
- [ ] Demo video (optional but recommended)
- [ ] Pricing plan(s)
- [ ] Support contact email + support/docs URL
- [ ] Categories and search terms

## Technical review readiness

- [ ] App installs and loads in a fresh development store
- [ ] OAuth + embedded App Bridge session verified end-to-end
- [ ] Customer-account UI extensions render and read `loyalty_state`
- [ ] Discount function deploys and applies redemptions at checkout
- [ ] Deployed to Fly.io with all secrets set (`SHOPIFY_API_SECRET`,
      `LOYALTY_ENGINE_SHARED_SECRET`, `LOYALTY_CUSTOMER_TOKEN_SECRET`,
      `DATABASE_URL`, optional `SENTRY_DSN`)
- [ ] Prisma migrations applied in production

## Submission

- [ ] Run `npm run deploy` to push app config + extensions
- [ ] Submit for review from the Partner Dashboard

---

# Listing copy (draft — paste into Partner Dashboard)

## App name (≤30 chars)
**LoyaltyFlow**

> Do not include "Shopify" in the name. If the reviewer flags the name as too
> generic, fall back to a brand-qualified form (e.g. "LoyaltyFlow by Ama Da Flow").

## Tagline / card subtitle (≤62 chars)
**Reward repeat customers with tiers, points & checkout discounts.**

Alternatives:
- Spend-based tiers, points, referrals — discounts auto-applied.
- Turn one-time buyers into loyal members. No code required.

## Key benefits (the 3 highlight cards)

**1. Tiered rewards that apply themselves**
Set spend thresholds (e.g. 5% / 10% / 15%) and the discount applies automatically
at checkout — no codes for customers to remember or paste.

**2. Points, referrals & redemptions**
Customers earn points on every paid order plus bonuses for signups, referrals,
birthdays, reviews, and social follows — then redeem them for discounts or free
shipping right at checkout.

**3. Built into the storefront & account**
A customer-account rewards panel and a theme widget show members their tier, points
balance, and rewards — no separate portal to manage.

## App details / long description

LoyaltyFlow turns one-time shoppers into repeat customers — without writing a line
of code.

Create spend-based reward tiers, award points automatically on every paid order, and
let customers redeem rewards as discounts or free shipping that apply themselves at
checkout. No coupon codes, no manual fulfilment.

**Reward tiers** — Define tiers by lifetime spend (for example, 5% at $300, 10% at
$700, 15% at $1,500). The matching discount is applied automatically by Shopify
Functions at checkout, so qualifying customers are rewarded instantly.

**Points & earn rules** — Customers earn points on paid orders and through bonus
actions you control: account signup, referrals, birthdays, product reviews,
newsletter subscriptions, and Instagram/TikTok follows. Refunds reverse the points
automatically, so balances stay accurate.

**Redemptions at checkout** — Publish a catalog of rewards customers can redeem with
points: a fixed-amount discount, a percentage discount, or free shipping — all
applied natively at checkout.

**Referrals** — Give members a referral link and reward both the referrer and the
new customer on the referred customer's first paid order, with built-in safeguards
against double-crediting.

**Storefront & customer account** — A rewards panel in the new customer accounts and
an optional theme app extension show members their tier, points, and available
rewards directly on your store.

**Privacy-first** — Loyalty data is stored on Shopify (customer metafields and
metaobjects) and fully supports Shopify's mandatory GDPR data-request and
data-erasure webhooks.

**Pricing** — Start free (up to 3 reward tiers and 3 earn rules). Upgrade to Pro for
unlimited tiers and earn rules, with a 14-day free trial.

## Categories
- Primary: **Marketing and conversion → Loyalty and rewards**
- Secondary (if allowed): **Customer accounts** or **Discounts**

## Search terms / keywords (pick ~5)
`loyalty` · `rewards` · `points` · `referrals` · `vip tiers` · `store credit`
· `repeat customers`

---

# Scope justifications (for the API access / review-notes form)

Every requested scope mapped to the feature that needs it. Scopes come from
`shopify.app.toml`.

| Scope | Why the app needs it | Breaks without it |
|---|---|---|
| `read_customers` | Read customer records and loyalty metafields to compute each member's tier and points balance. | Cannot determine a customer's loyalty state. |
| `write_customers` | Write the app's customer metafields: `loyalty_state`, `loyalty_points_balance`, `loyalty_active_redemption`, and referral attribution. | Cannot award/store points, redemptions, or referral credit. |
| `customer_read_customers` | Customer-account API access so the customer-account UI extension can read the signed-in customer's **own** loyalty state. | Rewards panel in customer accounts shows nothing. |
| `read_orders` | Award points on `orders/paid` and reverse them on `refunds/create` via webhooks. | No points earned on purchases; refunds can't roll back points. |
| `read_discounts` | Read the app's automatic discount to verify/reconcile its state during sync. | Cannot detect or repair the loyalty discount. |
| `write_discounts` | Create and manage the single automatic app discount that the Shopify Function uses to apply tier and redemption rewards at checkout. | Tier/redemption discounts can't be applied — the core reward mechanism fails. |
| `read_metaobjects` | Read the merchant-managed loyalty program config (tiers, earn rules, redemptions) stored as metaobjects. | Cannot load the program configuration. |
| `write_metaobjects` | Persist the merchant's tier/earn-rule/redemption configuration from the admin UI. | Merchants can't create or edit their loyalty program. |
| `read_metaobject_definitions` | Verify the loyalty metaobject definitions exist before reading/writing entries. | Setup/validation can't confirm the schema. |
| `write_metaobject_definitions` | Create the loyalty metaobject definitions on first setup (one-time schema install). | App can't initialize its data model on a fresh store. |

**Reviewer notes for the write-heavy scopes:**
1. The app requests `write_customers`, `write_discounts`, and `write_metaobjects`
   because it is a configuration + state-management app, not read-only analytics: it
   stores the loyalty program (metaobjects), the derived per-customer state (customer
   metafields), and the reward mechanism (one automatic app discount).
2. It writes **only** app-owned metafields/metaobjects and a single app-managed
   discount; it does not modify merchant products, pricing, or unrelated customer
   fields.

---

> See `HANDOFF.md` and `README.md` for architecture and deployment details.
