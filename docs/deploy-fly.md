# Deploy to Fly.io

Migration runbook for moving `apps/loyalty-engine` off Google Cloud Run + Neon and onto Fly.io + Fly Postgres. Optimized for small-POC simplicity — no Secret Manager dance, no pooler/direct-URL split, no connection-string gotchas.

**Why Fly for a POC:** one-command deploy, Dockerfile-based (no code changes), Fly Postgres attaches with a single `fly postgres attach` that auto-injects `DATABASE_URL`, VM-based (no cold-start surprises), scales to zero when idle. Eliminates the whole class of bugs documented in `deploy-cloud-run.md:363-367`.

**Estimated time:** 15-20 minutes for a fresh deploy.

---

## 0. Prerequisites

```bash
# Install flyctl (macOS)
brew install flyctl

# Log in (opens browser)
fly auth login

# Confirm
fly auth whoami
```

You also need your Shopify Partner Dashboard open in another tab — you'll update the app's URLs at the end.

---

## 1. Fix the existing `fly.toml`

The committed `apps/loyalty-engine/fly.toml` is leftover scaffolding from an earlier SQLite-based attempt and will NOT deploy correctly as-is (wrong port, SQLite mount). Replace its contents with:

```toml
app = "amadaflow-loyalty"
primary_region = "sin"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "8080"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

Changes vs current `fly.toml`:
- Port `3000` → `8080` (matches Dockerfile `ENV PORT=8080`)
- Removed `SESSION_DB_PATH` env (Postgres-based now, not SQLite)
- Removed `[[mounts]]` volume (no SQLite file to persist)

> **Tip:** keep `primary_region = "sin"` (Singapore) — matches the Cloud Run region (`asia-southeast1`) so webhook latency from Shopify's SEA region stays similar.

Commit this change before running `fly launch` / `fly deploy`.

---

## 2. Create the Fly app

```bash
cd apps/loyalty-engine

# Creates the app record on Fly; does NOT deploy yet
fly apps create amadaflow-loyalty
```

If `amadaflow-loyalty` is already taken globally on Fly, pick a different name and update `app = "..."` in `fly.toml` before continuing.

---

## 3. Provision Fly Postgres and attach it

```bash
# Create a small Postgres cluster — Fly will prompt for region (pick "sin")
fly postgres create \
  --name amadaflow-loyalty-db \
  --region sin \
  --initial-cluster-size 1 \
  --vm-size shared-cpu-1x \
  --volume-size 1

# Attach it to your app — this sets DATABASE_URL as a Fly secret automatically
fly postgres attach amadaflow-loyalty-db --app amadaflow-loyalty
```

After `attach`, `DATABASE_URL` is injected as a secret in the format:
```
postgres://loyalty:PASSWORD@amadaflow-loyalty-db.flycast:5432/loyalty?sslmode=disable
```

Note: Fly Postgres on flycast (internal 6PN network) does NOT use PgBouncer — this is a direct connection, so no `pgbouncer=true&connection_limit=1` needed. No need for `DIRECT_DATABASE_URL` either.

---

## 4. Set Shopify secrets

```bash
# From apps/loyalty-engine — pull values from your local .env or pasted from Partners
fly secrets set \
  SHOPIFY_API_KEY="c5ff65b56ee569153d29aee4bb268fa6" \
  SHOPIFY_API_SECRET="<paste from Partners → API credentials>" \
  SHOPIFY_APP_URL="https://amadaflow-loyalty.fly.dev" \
  SCOPES="<paste from .env>" \
  --app amadaflow-loyalty
```

`SHOPIFY_APP_URL` must match the Fly-assigned URL. The default is `https://<app-name>.fly.dev` — confirm with `fly apps open` later.

`SHOP_CUSTOM_DOMAIN` is optional — only set if you use one.

---

## 5. Deploy

```bash
fly deploy --app amadaflow-loyalty
```

Watch the logs. Two things must happen during container start:
1. `npx prisma migrate deploy` runs against the Fly Postgres (from `docker-start` in `package.json`). First deploy creates the `Session` table.
2. `react-router-serve` binds to `0.0.0.0:8080`.

If deploy hangs or fails on migrate, check:
- `fly logs --app amadaflow-loyalty`
- Most common cause on first deploy: `DATABASE_URL` missing because Postgres attach didn't happen → re-run step 3.

---

## 6. Update the Shopify Partner Dashboard

The Fly URL differs from the Cloud Run URL, so Partners must be re-synced.

### 6a. Update `shopify.app.toml`

```diff
- application_url = "https://amadaflow-loyalty-201907146826.asia-southeast1.run.app"
+ application_url = "https://amadaflow-loyalty.fly.dev"

  [auth]
  redirect_urls = [
-   "https://amadaflow-loyalty-201907146826.asia-southeast1.run.app/auth/callback",
-   "https://amadaflow-loyalty-201907146826.asia-southeast1.run.app/auth/shopify/callback",
-   "https://amadaflow-loyalty-201907146826.asia-southeast1.run.app/api/auth/callback"
+   "https://amadaflow-loyalty.fly.dev/auth/callback",
+   "https://amadaflow-loyalty.fly.dev/auth/shopify/callback",
+   "https://amadaflow-loyalty.fly.dev/api/auth/callback"
  ]
```

### 6b. Push to Partners

```bash
cd apps/loyalty-engine
npm run deploy    # runs `shopify app deploy` and syncs the toml
```

Confirm in the Partner Dashboard → Apps → *Ama Da Flow Loyalty Engine* → Configuration that `App URL` and `Allowed redirection URL(s)` show the `fly.dev` URL.

---

## 7. Install on dev store and smoke test

1. Partner Dashboard → *Ama Da Flow Loyalty Engine* → **Test your app** → select `adf-internal.myshopify.com`.
2. Approve install.
3. Embedded iframe should render the app's UI. No 401 in Network tab.
4. Verify a Session row was persisted:
   ```bash
   fly postgres connect --app amadaflow-loyalty-db
   ```
   Then in psql:
   ```sql
   SELECT id, shop, "isOnline", "accessToken" IS NOT NULL AS has_token
   FROM "Session"
   WHERE shop = 'adf-internal.myshopify.com';
   ```
   Expect ≥1 row with `has_token = true`. If zero rows, the OAuth callback did not persist — check `fly logs` for Prisma errors.

---

## 8. Rollback plan

If anything breaks post-migration:

1. **Revert Partners URLs** — in Partner Dashboard, change `App URL` back to the Cloud Run URL, or edit `shopify.app.toml` back and run `npm run deploy`.
2. **Cloud Run is still running** — the previous deployment at `https://amadaflow-loyalty-201907146826.asia-southeast1.run.app` hasn't been deleted. Traffic will resume to it once Partners is repointed.
3. **Sessions will NOT transfer** — users will need to reinstall the app. For a POC dev store this is fine; for prod, plan a session-data migration first.

Do not delete the Cloud Run service or Secret Manager secrets until the Fly deploy has been stable for at least one test-install cycle.

---

## 9. (Optional) Tear down Cloud Run + Neon after Fly is stable

Only do this after step 7 passes and you've confirmed Fly runs cleanly for 24-48 hours:

```bash
# Delete Cloud Run service
gcloud run services delete amadaflow-loyalty --region=asia-southeast1

# Delete Secret Manager secrets
gcloud secrets delete SHOPIFY_API_SECRET
gcloud secrets delete DATABASE_URL
gcloud secrets delete DIRECT_DATABASE_URL   # if created during the Neon fix attempt

# Delete Neon project — go to https://neon.tech dashboard → project → Settings → Delete
```

Archive `apps/loyalty-engine/docs/deploy-cloud-run.md` (don't delete — useful reference if you ever want to go back).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `fly deploy` hangs on "waiting for health check" | Container didn't bind `:8080` | `fly logs` — look for Prisma or startup errors before process exit. |
| `prisma migrate deploy` fails with `P1001 Can't reach database` | Postgres attach missed | `fly secrets list --app amadaflow-loyalty` — if `DATABASE_URL` missing, re-run `fly postgres attach`. |
| 401 on `/app` after install | Partner Dashboard still points at Cloud Run URL | Re-run step 6 — run `npm run deploy` from `apps/loyalty-engine`. |
| Machine stops after idle, first request is slow | `auto_stop_machines = "stop"` + `min_machines_running = 0` | Expected for POC. Set `min_machines_running = 1` in `fly.toml` if you need always-on. |
| Webhooks return 401 | HMAC secret mismatch | Fly `SHOPIFY_API_SECRET` doesn't match Partners → `fly secrets set SHOPIFY_API_SECRET=...`. |

---

## Cost estimate (Fly.io, POC)

| Resource | Monthly | Notes |
|----------|---------|-------|
| 1 × shared-cpu-1x / 512MB VM | ~$1.94 | Scales to 0 when idle — actual cost lower |
| 1 × shared Postgres 1GB | ~$1.94 | |
| **Total** | **~$4/mo** | Less if app stays mostly idle (scale-to-zero) |

Compare to Cloud Run + Neon: free tier on both, but ops burden is where the cost shows up.
