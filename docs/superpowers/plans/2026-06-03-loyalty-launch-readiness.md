# LoyaltyFlow Launch-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get LoyaltyFlow to demo-scale launch readiness — Admin UI + Managed Pricing working, Fly capacity verified, GDPR compliance deployed, and webhooks triggerable — so it *could* be submitted to Shopify Partners (not submitted this week).

**Architecture:** The engine is already live on Fly (`amadaflow-loyalty.fly.dev`, Postgres, React Router v7 + `@shopify/shopify-app-react-router`). This plan is deploy + dashboard-config + verify, not new code. Pricing is Shopify Managed Pricing (hosted by Shopify; the app only links to it). Webhooks and privacy URLs are declared in `shopify.app.loyaltyflow.toml` and ship via `shopify app deploy` (config-on-deploy enabled).

**Tech Stack:** Shopify CLI 3.93.2, `flyctl`, React Router v7, Prisma + Postgres, curl for endpoint verification.

**Spec:** `docs/superpowers/specs/2026-06-03-loyalty-launch-readiness-design.md`

**Legend:** ⛔ = step requires YOU (Partner Dashboard / secrets / browser). 🤖 = Claude runs it. Browser-gated UI checks pair a YOU action with a 🤖 `flyctl logs` capture for evidence.

**Working dir for all commands:** `/Users/naspadstudio/Documents/GitHub/amadaflow-apps/loyalty-engine`
**Branch:** `feat/launch-readiness`

---

## Task 1: Pre-flight — confirm clean baseline

**Files:** none (verification only)

- [ ] **Step 1 (🤖): Confirm branch + clean tree**

Run: `git branch --show-current && git status --short`
Expected: `feat/launch-readiness` and no uncommitted changes (only the spec/plan docs, if any).

- [ ] **Step 2 (🤖): Confirm the engine is live**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -m 20 https://amadaflow-loyalty.fly.dev/health`
Expected: `200`

- [ ] **Step 3 (🤖): Confirm extensions still build (rules out the original "build errors" report)**

Run: `npx shopify app build 2>&1 | tail -5`
Expected: `LoyaltyFlow built!`

- [ ] **Step 4 (🤖): Confirm flyctl is authed and see machine state**

Run: `flyctl status -a amadaflow-loyalty 2>&1 | head -20`
Expected: app shown, ≥1 machine `started`, region `sin`. If "not authenticated", STOP and ask the user to run `! flyctl auth login`.

---

## Task 2: Confirm the app handle (drives the pricing URL)

**Files:**
- Reference: `app/loyalty/billing.server.ts:57-67` (`managedPricingUrl` uses `SHOPIFY_APP_HANDLE`, defaults to `loyaltyflow`)

- [ ] **Step 1 (🤖): Show the current handle source**

Run: `grep -n "SHOPIFY_APP_HANDLE" .env .env.example 2>/dev/null; flyctl secrets list -a amadaflow-loyalty 2>&1 | grep -i handle || echo "no SHOPIFY_APP_HANDLE fly secret set (code default 'loyaltyflow' applies)"`
Expected: either a secret named `SHOPIFY_APP_HANDLE`, or the "default applies" message.

- [ ] **Step 2 (⛔): Confirm the real handle in the Partner Dashboard**

In Partner Dashboard → Apps → LoyaltyFlow, read the app **handle** (shown in the app's URL / overview). Tell Claude the exact value.
Expected: you report the handle string (e.g. `loyaltyflow`).

- [ ] **Step 3 (🤖, only if handle ≠ `loyaltyflow`): Set the Fly secret**

Run (substitute the real handle): `flyctl secrets set SHOPIFY_APP_HANDLE=<handle> -a amadaflow-loyalty`
Expected: secret set; Fly redeploys the machine. Re-check `curl .../health` → `200`.
If handle IS `loyaltyflow`: skip — no change needed.

---

## Task 3: Create Managed Pricing plans (fixes the pricing 404)

**Files:** none (Shopify-hosted; no repo change)

- [ ] **Step 1 (⛔): Create the plans**

Partner Dashboard → Apps → LoyaltyFlow → **Managed pricing** → create:
- **Free** — $0, no trial. (Maps to soft-gate: 3 tiers / 3 rules.)
- **Pro** — $9.99 USD / month recurring, **14-day trial**. (Maps to: unlimited tiers/rules.)
Publish/activate both.
Expected: dashboard shows two active plans.

- [ ] **Step 2 (⛔): Verify the pricing page no longer 404s**

Open in a browser (logged into the dev store):
`https://admin.shopify.com/store/vic-test-rczyeeqw/charges/<handle>/pricing_plans`
Expected: the page renders both plans (no 404). Tell Claude pass/fail.

- [ ] **Step 3 (⛔ + 🤖): Verify the in-app upgrade link**

YOU: open the app at `/app` in the dev store and click the upgrade / pricing CTA.
🤖 (in parallel): `flyctl logs -a amadaflow-loyalty | grep -i "pricingUrl\|managedPricing" ` is not logged, so instead confirm the rendered link target points to the same `charges/<handle>/pricing_plans` URL (inspect the CTA href).
Expected: CTA navigates to the working pricing page.

---

## Task 4: Verify billing soft-gate behaviour

**Files:**
- Reference: `app/loyalty/billing.server.ts:35-51` (`getActivePlan`), and the gate usage in `app/routes/app._index.tsx`

- [ ] **Step 1 (⛔): Confirm Free-plan gate**

On the dev store (currently Free / no active subscription), in the app try to create a **4th reward tier** (or 4th earn rule).
Expected: the UI blocks it with an upgrade prompt (Free = max 3 tiers / 3 rules).

- [ ] **Step 2 (🤖): Capture evidence in logs while Step 1 runs**

Run during Step 1: `flyctl logs -a amadaflow-loyalty 2>&1 | grep -iE "subscription|isPro|plan|gate" | tail -20`
Expected: no errors from `getActivePlan` (it fails-open to Free on error — confirm it's resolving, not erroring).

- [ ] **Step 3 (⛔, optional): Confirm Pro unlocks**

If you start the Pro **14-day trial** from the pricing page, repeat Step 1.
Expected: adding a 4th tier/rule is now allowed. (Optional — trial can be tested later.)

---

## Task 5: Admin UI smoke test

**Files:**
- Reference routes: `app/routes/app._index.tsx`, `app.customers.tsx`, `app.reward-programs.tsx`, `app.settings.tsx`

- [ ] **Step 1 (⛔ + 🤖): Load every admin route**

YOU: with `shopify app dev` running, open each in the embedded admin:
`/app` (dashboard + on/off toggle), `/app/customers`, `/app/reward-programs`, `/app/settings`.
🤖 (in parallel): `flyctl logs -a amadaflow-loyalty` is not used here (dev runs locally); instead watch the local `shopify app dev` terminal for 500s.
Expected: each page renders; no error boundary.

- [ ] **Step 2 (⛔): Exercise a save + the master toggle**

YOU: toggle the program Active/Paused on `/app` (or `/app/settings`), and save a tier edit on `/app/reward-programs`.
Expected: toggle persists on reload; tier save succeeds. Report any failure (with the page + message) to Claude.

- [ ] **Step 3 (🤖): Record known cosmetic issue (no fix this week)**

Note in the run log: `app.reward-programs.tsx` re-exports `app._index.tsx` (home/programs split parked per spec). No action.

---

## Task 6: Deploy app config + extensions (registers webhooks + privacy URLs)

**Files:**
- Reference: `shopify.app.loyaltyflow.toml` (webhooks lines 12-45; `include_config_on_deploy = true` line 10)

- [ ] **Step 1 (🤖): Confirm the TOML declares all subscriptions + privacy URLs**

Run: `grep -nE "topics|privacy_compliance|_url|include_config_on_deploy" shopify.app.loyaltyflow.toml`
Expected: see `orders/paid`, `refunds/create`, `metaobjects/*`, `app/uninstalled`, `app/scopes_update`, the three `*_url` privacy entries, and `include_config_on_deploy = true`.

- [ ] **Step 2 (🤖 or ⛔): Deploy app config + function extension to Shopify**

Run: `npx shopify app deploy -f 2>&1 | tail -30`
(If it prompts for confirmation interactively, YOU run `! npx shopify app deploy` instead.)
Expected: "Deployed to Shopify!" / a new app version created; webhook + privacy + extension modules listed.

- [ ] **Step 3 (🤖): Confirm a new active version exists**

Run: `npx shopify app versions list 2>&1 | head -15`
Expected: the just-created version is the active release.

---

## Task 7: Verify webhook + privacy subscriptions registered

**Files:** none

- [ ] **Step 1 (🤖): List registered webhook subscriptions via Admin API**

YOU may need to be running `shopify app dev` (provides an admin session). Then 🤖 confirms from the deploy output of Task 6 Step 2 that these modules registered: `orders/paid`, `refunds/create`, `metaobjects/create|update|delete`, `app/uninstalled`, `app/scopes_update`, and the three privacy_compliance topics.
Expected: all listed in the deploy module summary.

- [ ] **Step 2 (🤖): Confirm privacy endpoints reject unsigned POSTs (HMAC enforced)**

Run:
```bash
for p in customers/data-request customers/redact shop/redact; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 20 -X POST \
    "https://amadaflow-loyalty.fly.dev/webhooks/$p" \
    -H 'Content-Type: application/json' -d '{}')
  echo "$p -> HTTP $code"
done
```
Expected: each returns `401` (no valid HMAC). A `401` here is success — it proves `authenticate.webhook()` is enforcing signatures.

---

## Task 8: Trigger order webhooks and observe handlers

**Files:**
- Reference: `app/routes/webhooks.orders-paid.tsx`, `app/routes/webhooks.orders-refunded.tsx`

- [ ] **Step 1 (🤖): Start streaming production logs**

Run (background): `flyctl logs -a amadaflow-loyalty`
Keep this streaming during Steps 2-3.

- [ ] **Step 2 (🤖): Trigger `orders/paid` against the deployed endpoint**

Run: `npx shopify app webhook trigger --topic orders/paid --api-version 2026-04 --delivery-method http --address https://amadaflow-loyalty.fly.dev/webhooks/orders-paid --client-secret "$SHOPIFY_API_SECRET" 2>&1 | tail -15`
(If `SHOPIFY_API_SECRET` isn't in the shell, the CLI signs with the app's secret automatically when run as `npx shopify app webhook trigger` and selecting the app — fall back to the interactive form `! npx shopify app webhook trigger`.)
Expected: CLI reports "Webhook delivered". Logs show `Received orders/paid webhook for <shop>`. (The sample payload may lack a real customer, so it short-circuits after logging — that is the expected "triggerable" proof.)

- [ ] **Step 3 (🤖): Trigger `refunds/create`**

Run: `npx shopify app webhook trigger --topic refunds/create --api-version 2026-04 --delivery-method http --address https://amadaflow-loyalty.fly.dev/webhooks/orders-refunded 2>&1 | tail -15`
Expected: "Webhook delivered"; logs show the refund handler entered.

- [ ] **Step 4 (⛔, optional — full-path proof): Real test order**

YOU: place a test order on the dev store for a customer, mark it paid.
🤖: in the streaming logs, expect `Received orders/paid webhook`, then a points award; verify the customer's `loyalty_state` / `loyalty_points_balance` metafield updated (visible in the app's Customers page). Then refund it and watch the debit.
Expected: points awarded on paid, debited on refund, idempotency guard prevents double-award on retry.

---

## Task 9: Fly.io capacity check (demo-scale)

**Files:**
- Reference: `fly.toml` (`min_machines_running=1`, auto start/stop, `/health` check; 512 MB / 1 shared CPU)

- [ ] **Step 1 (🤖): Review config for demo-scale sanity**

Run: `grep -nE "min_machines_running|auto_|memory_mb|cpus|cpu_kind|interval|path" fly.toml`
Expected: `min_machines_running = 1`, `auto_start_machines = true`, `auto_stop_machines`, `/health` check, 512 MB. For 1-5 stores this is adequate — record as PASS.

- [ ] **Step 2 (🤖): Light concurrent burst against health + public API**

Run:
```bash
echo "health burst:"; for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code} %{time_total}\n" -m 20 https://amadaflow-loyalty.fly.dev/health & done; wait
echo "public-loyalty-program burst:"; for i in $(seq 1 20); do curl -s -o /dev/null -w "%{http_code}\n" -m 20 "https://amadaflow-loyalty.fly.dev/api/public-loyalty-program?shop=vic-test-rczyeeqw.myshopify.com" & done; wait
```
Expected: health all `200` with low times; public API returns a consistent status (200, or its documented auth/4xx — note whichever). No 5xx / timeouts.

- [ ] **Step 3 (🤖): Confirm no memory pressure + 2nd machine behaviour**

Run: `flyctl status -a amadaflow-loyalty | sed -n '1,20p'; echo '---'; flyctl logs -a amadaflow-loyalty 2>&1 | grep -iE "OOM|out of memory|killed|memory" | tail -5 || echo "no memory warnings"`
Expected: machine(s) healthy, no OOM lines. Record headroom verdict as PASS for demo scale.

---

## Task 10: Draft the privacy policy

**Files:**
- Create: `docs/legal/privacy-policy.md`

- [ ] **Step 1 (🤖): Draft the policy from the app's actual data handling**

Write `docs/legal/privacy-policy.md` covering what the app collects/stores, derived from the codebase: customer GID + derived loyalty state/points/redemption/referral data stored in **Shopify customer metafields** (not in the app DB), Prisma stores only Shopify sessions, order/refund data processed transiently for points, GDPR handlers for data-request / redact / shop-redact, data retention (cleared on `app/uninstalled` and `shop/redact`), no third-party sharing except Sentry (errors) if enabled. Include controller/contact placeholder for Amada Flow to fill.
Expected: a complete draft, no "TBD" except the contact email/legal entity line clearly marked `<<FILL: ...>>`.

- [ ] **Step 2 (⛔): Review + decide hosting**

YOU: review the draft, fill the `<<FILL>>` contact/entity lines, and decide where it's hosted (e.g. a public URL on the marketing site or a Fly route). The **hosted URL** is the field Partners needs at submission time.
Expected: approved policy text + a hosting plan / URL.

- [ ] **Step 3 (🤖): Commit the draft**

Run:
```bash
git add docs/legal/privacy-policy.md
git commit -m "docs(loyalty-engine): privacy policy draft for Partners submission"
```
Expected: committed on `feat/launch-readiness`.

---

## Task 11: Update HANDOFF + final readiness checklist

**Files:**
- Modify: `HANDOFF.md` (App Store submission checklist section)

- [ ] **Step 1 (🤖): Re-run the full evidence sweep**

Run:
```bash
echo "health:"; curl -s -o /dev/null -w "%{http_code}\n" https://amadaflow-loyalty.fly.dev/health
echo "privacy hmac (expect 401 each):"; for p in customers/data-request customers/redact shop/redact; do curl -s -o /dev/null -w "$p %{http_code}\n" -X POST "https://amadaflow-loyalty.fly.dev/webhooks/$p" -d '{}'; done
echo "active version:"; npx shopify app versions list 2>&1 | head -5
```
Expected: health 200; three 401s; an active deployed version.

- [ ] **Step 2 (🤖): Mark the checklist**

Update `HANDOFF.md`'s "App Store submission checklist" so each item reflects verified reality: `shopify app deploy` ✓, GDPR URLs deployed ✓, Managed Pricing plans created ✓ (after Task 3), privacy policy draft ✓ (hosted URL pending), webhooks triggerable ✓. Leave genuinely-pending items (listing/screenshots, actual submission) marked Pending.
Expected: checklist matches what was actually verified — no over-claiming.

- [ ] **Step 3 (🤖): Commit**

Run:
```bash
git add HANDOFF.md
git commit -m "docs(loyalty-engine): update submission checklist after launch-readiness verification"
```
Expected: committed.

- [ ] **Step 4 (🤖): Summarize remaining blockers to submission**

Print a short list of what still stands between "ready" and "submitted": hosted privacy-policy URL, app listing copy + screenshots, and the final Submit click. (All out of scope this week per spec.)

---

## Self-Review Notes

- **Spec coverage:** Goal 1 → Tasks 2-5; Goal 2 → Task 9; Goal 3 → Tasks 6,7,10; Goal 4 → Tasks 6,7,8. Privacy-policy task added (spec Goal 3 step 10). Reward-programs split parked (Task 5 Step 3). All spec sections mapped.
- **Browser-gated reality:** admin-UI acceptance steps are necessarily YOU-in-browser; each is paired with a Claude log/href capture so there's still evidence.
- **No code changes** are required unless the app handle differs (Task 2 Step 3, a Fly secret — not code). If Task 5 surfaces a real bug, that spawns a separate fix outside this plan.
