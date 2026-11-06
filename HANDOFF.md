# Handoff

State as of 6 Nov 2026. Live revision: `amadaflow-loyalty-00017-dcj`. Overview and commands are in [README.md](README.md). History and decisions: `docs/superpowers/plans/2026-09-29-restart.md` and the other plans and specs under `docs/superpowers/`.

## Where things live

- Private Shopify app on Custom distribution, for the Amada Flow store only. Config: `shopify.app.loyaltyflow.toml`.
- Hosting is all GCP: Cloud Run, Cloud SQL (private IP only), Secret Manager, Cloud Logging and Error Reporting. Errors come from `console.error`. There is no Sentry. See [docs/deploy-cloud-run.md](docs/deploy-cloud-run.md).
- Points and balances are Shopify customer metafields. Writes use `compareDigest` (`saveLoyaltyCustomer`), so a stale write fails instead of overwriting.
- Postgres holds only: `Session`, `ProcessedWebhook` (once-only webhook keys) and `PointsEvent` (points history). See `prisma/schema.prisma`.
- The program (tiers, earn rules, rewards) is stored as Shopify metaobjects. A snapshot of it is kept in an app metafield for the checkout extension and the engine.

## How the flows work

**Order paid** (`webhooks.orders-paid.tsx`): run once per order (`runOnce`). Adds per-$ order points, flat order points, the signup bonus on the first order, and the referral bonus for both sides. Clears the reward used at checkout. Guest orders are skipped. Any failure returns 500 so Shopify retries.

**Refund** (`webhooks.orders-refunded.tsx`, topic `refunds/create`): run once per refund. Takes back only per-$ order points. Flat order points stay. Pending payment-app refunds count. A refund with no money is ignored.

**Redeem** (`api.redeem.tsx`): checks the customer token, creates a single-use discount code for that customer (`createRewardCode`), then takes the points. If saving the balance fails (for example a double click changed it), the code is deleted again (`deleteRewardCode`), so a reward is never free and never paid twice. One active reward at a time; it expires after 30 days.

**Tier discounts** (`syncTierDiscounts` in `admin.server.ts`): one built-in automatic discount per tier, limited to that tier's customer segment. Re-synced on Sync program, Initialize, tier saves and Activate/Pause (pausing removes them). Tiers use Shopify's lifetime spend.

**Referral:** the storefront saves `?ref=` in an `adf_ref` cookie and calls `/api/attribute-referral` on a signed-in page load. The engine refuses customers who already have orders. Points are paid when the new customer's first order is paid. Checked end to end on the live store on 4 Nov.

**GDPR:** customer redact clears the loyalty metafields and deletes that customer's `PointsEvent` rows. Shop redact deletes all of the shop's `PointsEvent` rows. App uninstall deletes the sessions.

**Storefront calls:** `/api/customer-state`, `/api/redeem`, `/api/attribute-referral`. Headers: `X-Loyalty-Engine-Secret`, `X-Shopify-Shop-Domain`, and `X-Loyalty-Customer-Token` (an HMAC bound to one customer). See `app/loyalty/engine-auth.server.ts`. The storefront deploys from the `dev` branch of its repo.

## Important files

| File | What |
|---|---|
| `app/loyalty/customer-state.server.ts` | load and save customers, reward codes, referral attribution, manual adjust |
| `app/loyalty/admin.server.ts` | metaobject setup, tier editor, tier discounts |
| `app/loyalty/program.server.ts` | program snapshot sync |
| `app/loyalty/run-once.server.ts` | once-only webhook guard |
| `app/loyalty/points-history.server.ts` | `PointsEvent` write and read |
| `app/loyalty/engine-auth.server.ts` | storefront auth and customer tokens |
| `src/domain/customer-state.ts` | pure rules: paid order, redemption, refund, referral |
| `app/routes/app._index.tsx` | program editor |
| `app/routes/app.customers_.$id.tsx` | customer page: history and adjust |
| `docs/earn-rules-redemptions.md` | earn rules and redemptions notes |

## Operations

**Deploy:** `gcloud run deploy amadaflow-loyalty --source . --project loyalty-engine-494212 --region asia-southeast1`. Traffic follows the latest revision. Migrations run on container start.

**Warning:** `gcloud run services update-traffic --to-revisions X=100` pins traffic to revision X. Later deploys then get 0% until you run `gcloud run services update-traffic amadaflow-loyalty --to-latest` (same project and region flags). This happened on 4 Nov.

**CPU throttling is off (`--no-cpu-throttling`, since 6 Nov).** Keep it off. With throttling on, a fresh min-instance gets almost no CPU until its first request, so the session storage's startup DB check times out. The library then throws "session table does not exist" (misleading) as an unhandled rejection and the container exits 1. Crashes on 29 Oct, 30 Oct and 6 Nov. `gcloud run deploy` keeps this setting.

**Logs:** Cloud Logging for the service; Error Reporting for errors. Webhook lines start with `[loyalty]`.

**Rollback:** list revisions with `gcloud run revisions list`, then send traffic to the good one. When fixed, deploy and run `--to-latest` to unpin. Migrations are not undone by a rollback, so keep them additive.

## Open follow-ups

- Live-store redeem test and customer page checks (planned 5 Nov).
- GCP budget alert: needs a billing admin (account `0146FB-34F4D1-063771`).
- Decide whether tiers use gross or net spend.
- Admin UI polish (the rest of piece A) and Klaviyo events (piece B).
- Archive the old `loyaltyflow` prototype repo.
- Storefront PR for profile card points: https://github.com/dotcross-ai/amadaflow.com/pull/21
