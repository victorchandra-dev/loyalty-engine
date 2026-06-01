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
- [ ] Confirm requested scopes are all justified at review time (the app requests
      a broad set incl. `write_customers`, `write_discounts`, `write_metaobjects`).

## Compliance / privacy

- [x] GDPR webhook handlers implemented (customers data request, customers redact,
      shop redact).
- [ ] **Privacy policy URL** — public page describing data handling (required field).
- [ ] Confirm customer metafields written by the app (`loyalty_state`,
      `loyalty_points_balance`, etc.) are covered by `customers/redact`.

## Listing content (Partner Dashboard)

- [ ] App name, tagline, and description
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

> See `HANDOFF.md` and `README.md` for architecture and deployment details.
