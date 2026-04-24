# Deploying the Loyalty Engine to Google Cloud Run

This guide deploys the embedded Shopify admin app in `apps/loyalty-engine/` to Google Cloud Run, backed by a Cloud SQL Postgres instance for session storage.

## Architecture

```text
Shopify Admin iframe ──▶ Cloud Run service (amadaflow-loyalty)
                                │
                                ▼
                       Cloud SQL Postgres (loyalty-pg)
                         — stores Shopify sessions
                         — migrations applied at container start
```

- **Cloud Run**: builds and runs the Docker image, auto-HTTPS, scales to zero when idle.
- **Cloud SQL Postgres (`db-f1-micro`)**: cheapest tier, ~$9/mo. Sessions survive container restarts.
- **Secret Manager**: stores `SHOPIFY_API_SECRET` and `DATABASE_URL`.

Expected monthly cost at low admin traffic: **~$9** (Cloud Run in free tier; Cloud SQL is the floor).

## Prerequisites

- `gcloud` CLI installed and on PATH (`gcloud --version` works).
- A GCP project with billing enabled.
- Shopify app already deployed via `npm run deploy` so the Partner Dashboard has the correct scopes.
- The latest API secret from `shopify app env pull` (or rotated from Partner Dashboard).

## 1. Authenticate + select project

```bash
gcloud auth login                         # opens browser
gcloud config set project YOUR_PROJECT_ID
gcloud config set run/region asia-southeast1
```

If you need to create a new project:

```bash
gcloud projects create amadaflow-infra --name="Ama Da Flow"
gcloud config set project amadaflow-infra

# Link billing — get the account ID via `gcloud beta billing accounts list`
gcloud beta billing projects link amadaflow-infra --billing-account=YOUR_BILLING_ACCOUNT_ID
```

## 2. Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com
```

## 3. Create Cloud SQL Postgres

> If your org enforces `constraints/sql.restrictPublicIp`, use **3a + 3b (private IP)** below. Otherwise use **3c (public IP)** — simpler, no VPC setup.

### 3a. VPC peering (only needed for private IP path)

Enables Google-managed services (Cloud SQL) to live on your VPC.

```bash
gcloud services enable servicenetworking.googleapis.com

gcloud compute addresses create google-managed-services-default \
  --global \
  --purpose=VPC_PEERING \
  --prefix-length=16 \
  --network=default

gcloud services vpc-peerings connect \
  --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services-default \
  --network=default
```

Runs once per project. "Already exists" errors on re-run are safe to ignore.

### 3b. Create Cloud SQL with PRIVATE IP

```bash
gcloud sql instances create loyalty-pg \
  --database-version=POSTGRES_16 \
  --edition=ENTERPRISE \
  --tier=db-f1-micro \
  --region=asia-southeast1 \
  --storage-size=10GB \
  --storage-type=HDD \
  --backup-start-time=18:00 \
  --network=default \
  --no-assign-ip \
  --async
```

### 3c. Create Cloud SQL with PUBLIC IP (skip if using 3a/3b)

```bash
gcloud sql instances create loyalty-pg \
  --database-version=POSTGRES_16 \
  --edition=ENTERPRISE \
  --tier=db-f1-micro \
  --region=asia-southeast1 \
  --storage-size=10GB \
  --storage-type=HDD \
  --backup-start-time=18:00 \
  --async
```

> `--edition=ENTERPRISE` is required. Newer GCP projects default to `ENTERPRISE_PLUS`, which rejects shared-core tiers like `db-f1-micro` and forces expensive `db-perf-optimized-N-*` tiers (~$120/mo minimum).

Wait for it to finish:

```bash
until [ "$(gcloud sql instances describe loyalty-pg --format='value(state)')" = "RUNNABLE" ]; do
  echo "Waiting for Cloud SQL..."
  sleep 15
done
echo "Instance ready"
```

## 4. Set password, create database, save connection string

```bash
# Set the postgres user password — prompts you, paste, Enter
gcloud sql users set-password postgres \
  --instance=loyalty-pg \
  --prompt-for-password

# Create the app database
gcloud sql databases create loyalty --instance=loyalty-pg

# For PUBLIC IP path (3c): save the instance connection string
INSTANCE_CONN=$(gcloud sql instances describe loyalty-pg --format='value(connectionName)')
echo "Instance connection: $INSTANCE_CONN"
# Format: PROJECT_ID:REGION:INSTANCE_NAME

# For PRIVATE IP path (3a/3b): save the private IP instead
PG_PRIVATE_IP=$(gcloud sql instances describe loyalty-pg \
  --format='value(ipAddresses[0].ipAddress)')
echo "Private IP: $PG_PRIVATE_IP"
```

## 5. Store secrets in Secret Manager

```bash
# Shopify API secret — paste the secret, Enter, then Ctrl+D
gcloud secrets create SHOPIFY_API_SECRET --data-file=-

# DATABASE_URL — two forms depending on which path you took

# PUBLIC IP path (3c): Unix socket via Cloud SQL Auth Proxy
printf 'postgresql://postgres:YOUR_PG_PASSWORD@localhost/loyalty?host=/cloudsql/%s' "$INSTANCE_CONN" \
  | gcloud secrets create DATABASE_URL --data-file=-

# PRIVATE IP path (3a/3b): direct TCP to the private IP
printf 'postgresql://postgres:YOUR_PG_PASSWORD@%s:5432/loyalty' "$PG_PRIVATE_IP" \
  | gcloud secrets create DATABASE_URL --data-file=-

# Verify both exist
gcloud secrets list
```

If you ever need to rotate a secret:

```bash
# Add a new version
printf 'new-secret-value' | gcloud secrets versions add SHOPIFY_API_SECRET --data-file=-

# Cloud Run picks up the new version on next deploy (or immediately if using `:latest`)
```

## 6. First deploy

From `apps/loyalty-engine/`:

### Public IP path (3c)

```bash
cd apps/loyalty-engine

gcloud run deploy amadaflow-loyalty \
  --source . \
  --region=asia-southeast1 \
  --platform=managed \
  --allow-unauthenticated \
  --add-cloudsql-instances="$INSTANCE_CONN" \
  --set-env-vars="^##^SHOPIFY_API_KEY=c5ff65b56ee569153d29aee4bb268fa6##SCOPES=read_customers,write_customers,read_orders,read_discounts,write_discounts,read_metaobjects,write_metaobjects,read_metaobject_definitions,write_metaobject_definitions" \
  --update-secrets="SHOPIFY_API_SECRET=SHOPIFY_API_SECRET:latest,DATABASE_URL=DATABASE_URL:latest" \
  --min-instances=0 \
  --max-instances=3 \
  --cpu=1 \
  --memory=512Mi \
  --timeout=60 \
  --port=8080
```

### Private IP path (3a/3b) — Direct VPC Egress

```bash
cd apps/loyalty-engine

gcloud run deploy amadaflow-loyalty \
  --source . \
  --region=asia-southeast1 \
  --platform=managed \
  --allow-unauthenticated \
  --network=default \
  --subnet=default \
  --vpc-egress=private-ranges-only \
  --set-env-vars="^##^SHOPIFY_API_KEY=c5ff65b56ee569153d29aee4bb268fa6##SCOPES=read_customers,write_customers,read_orders,read_discounts,write_discounts,read_metaobjects,write_metaobjects,read_metaobject_definitions,write_metaobject_definitions" \
  --update-secrets="SHOPIFY_API_SECRET=SHOPIFY_API_SECRET:latest,DATABASE_URL=DATABASE_URL:latest" \
  --min-instances=0 \
  --max-instances=3 \
  --cpu=1 \
  --memory=512Mi \
  --timeout=60 \
  --port=8080
```

Private-IP differences: `--add-cloudsql-instances` dropped (no Unix socket), `--network/--subnet/--vpc-egress` added (Direct VPC Egress so Cloud Run can reach the VPC-internal private IP).

**Key flags explained:**

- `--source .` — Cloud Build builds the image from the local Dockerfile, pushes to Artifact Registry, deploys.
- `--add-cloudsql-instances` — attaches the Cloud SQL socket at `/cloudsql/INSTANCE_CONN` inside the container.
- `^##^...` in `--set-env-vars` — custom delimiter so commas inside `SCOPES` don't break parsing.
- `--update-secrets ...:latest` — mounts Secret Manager values as env vars; `:latest` auto-picks the newest version.
- `--min-instances=0` — scales to zero when idle (free tier friendly).

First deploy takes 5-8 minutes. Output ends with:

```text
Service URL: https://amadaflow-loyalty-xxxxx-as.a.run.app
```

**Copy that URL** — you need it next.

## 7. Set the Shopify app URL

```bash
gcloud run services update amadaflow-loyalty \
  --region=asia-southeast1 \
  --update-env-vars="SHOPIFY_APP_URL=https://amadaflow-loyalty-xxxxx-as.a.run.app"
```

## 8. Update Shopify app config

Edit `apps/loyalty-engine/shopify.app.toml` line 5:

```toml
application_url = "https://amadaflow-loyalty-xxxxx-as.a.run.app"
```

Then sync to Shopify:

```bash
npm run deploy
# "Release this version?" → y
```

This updates the Partner Dashboard app URL and webhook subscriptions to point at Cloud Run.

## 9. Test install

In Shopify Partner Dashboard:

1. Go to **Apps** → **Ama Da Flow Loyalty Engine** → **Test your app**.
2. Pick the `adf-internal` dev store (or another test store).
3. Approve the install prompt — the browser lands in the embedded admin UI.

In a separate terminal, tail logs:

```bash
gcloud run services logs tail amadaflow-loyalty --region=asia-southeast1
```

Expected log sequence on first request:

```text
1. Applying migration 20260423000000_init           (Prisma migrations apply against Cloud SQL)
2. [shopify-api/INFO] version 12.3.0, environment React Router  (app booted)
3. Received APP_UNINSTALLED webhook for adf-internal.myshopify.com  (cleanup of previous install)
4. Embedded UI renders
```

Save a tier in the admin UI. On the storefront side, visit `https://amadaflow.com/account/loyalty` — it should reflect the saved tier.

## Redeploying after code changes

```bash
cd apps/loyalty-engine

# Rebuild + redeploy — re-uses the Cloud SQL connection + secrets
gcloud run deploy amadaflow-loyalty \
  --source . \
  --region=asia-southeast1
```

Cloud Build rebuilds incrementally — subsequent deploys are faster (~2-3 min).

## Adding a new Prisma migration

1. Update `prisma/schema.prisma`.
2. Generate a new migration locally against a dev Postgres:

   ```bash
   DATABASE_URL=postgresql://postgres:localdev@localhost:5432/postgres \
     npx prisma migrate dev --name describe_your_change
   ```

3. Commit the new `prisma/migrations/<timestamp>_describe_your_change/` folder.
4. Redeploy (see above). `prisma migrate deploy` runs at container start and applies the new migration against Cloud SQL.

## Common problems and fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `P1001 Can't reach database server at localhost:5432` | Cloud SQL socket path wrong in `DATABASE_URL` | Re-check the `host=/cloudsql/$INSTANCE_CONN` segment of the secret; confirm `--add-cloudsql-instances` flag on deploy. |
| `Table 'Session' does not exist` | Migrations never ran | Check startup logs — `docker-start` script must run `prisma migrate deploy` before `react-router-serve`. Redeploy if missing. |
| 503 Service Unavailable, no app logs | Container crashed before binding | Check Cloud Run logs for startup errors. Most common: missing env var (`SHOPIFY_API_KEY`, `DATABASE_URL`). |
| Shopify auth redirect loop | `SHOPIFY_APP_URL` doesn't match Cloud Run URL | Re-run step 7 with the exact Service URL. |
| `prisma migrate deploy` succeeds but auth still 401 | Partner Dashboard app config stale | Run `npm run deploy` locally (step 8). |
| Webhooks return 500 | Shopify can't reach the app | Confirm `--allow-unauthenticated` was set on deploy (Cloud Run requires it for public webhook endpoints). |
| Cold start takes >10 seconds | Cloud SQL first-connection penalty | Optional: set `--min-instances=1` to keep one warm container (~$10/mo extra). |

## Useful diagnostic commands

```bash
# Show current service config
gcloud run services describe amadaflow-loyalty --region=asia-southeast1

# List all environment variables (secrets show only the reference, not value)
gcloud run services describe amadaflow-loyalty --region=asia-southeast1 \
  --format='yaml(spec.template.spec.containers[0].env)'

# List recent deployments
gcloud run revisions list --service=amadaflow-loyalty --region=asia-southeast1

# Roll back to previous revision
gcloud run services update-traffic amadaflow-loyalty \
  --region=asia-southeast1 \
  --to-revisions=amadaflow-loyalty-00002-xyz=100

# Cloud SQL connection test from local shell (requires cloud-sql-proxy)
gcloud sql connect loyalty-pg --user=postgres --database=loyalty
```

## Teardown (emergency / decommissioning)

If you need to tear everything down and stop billing:

```bash
# Delete Cloud Run service
gcloud run services delete amadaflow-loyalty --region=asia-southeast1

# Delete Cloud SQL instance (THIS DELETES THE DATABASE + ALL SESSIONS)
gcloud sql instances delete loyalty-pg

# Delete secrets
gcloud secrets delete SHOPIFY_API_SECRET
gcloud secrets delete DATABASE_URL

# Delete Artifact Registry repo (Cloud Run auto-created it)
gcloud artifacts repositories delete cloud-run-source-deploy \
  --location=asia-southeast1
```

## Files this deploy depends on

| File | Purpose |
| --- | --- |
| `apps/loyalty-engine/Dockerfile` | Multi-stage build: installs deps → runs `prisma generate` → `react-router build` → copies artifacts into slim runtime image. |
| `apps/loyalty-engine/prisma/schema.prisma` | Defines `Session` model; Postgres provider. |
| `apps/loyalty-engine/prisma/migrations/` | Committed migration SQL — applied at container start via `prisma migrate deploy`. |
| `apps/loyalty-engine/app/session-storage.server.ts` | Instantiates `PrismaSessionStorage(prisma)`. |
| `apps/loyalty-engine/app/shopify.server.ts` | Wires Prisma session storage into the Shopify app instance. |
| `apps/loyalty-engine/package.json` | `docker-start` script runs `prisma migrate deploy && npm run start`. |
| `apps/loyalty-engine/shopify.app.toml` | `application_url` must match the Cloud Run URL after first deploy. |
