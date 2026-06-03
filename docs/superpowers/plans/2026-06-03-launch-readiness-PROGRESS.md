# LoyaltyFlow Launch-Readiness — Progress & Continuation

**Snapshot date:** 2026-06-03
**Branch:** `feat/launch-readiness`
**Plan:** `docs/superpowers/plans/2026-06-03-loyalty-launch-readiness.md`
**Spec:** `docs/superpowers/specs/2026-06-03-loyalty-launch-readiness-design.md`

Goal for the week: demo-scale launch readiness (Admin UI + Pricing working, Fly capacity OK,
GDPR/compliance deployed, webhooks triggerable) → **submission-ready, not submitted**.
Decisions: demo scale (1–5 stores); Pricing = Free ($0) + Pro ($9.99/mo, 14-day trial);
Partners = ready but not submitted.

---

## ✅ Completed (verified with evidence)

| Task | Result | Evidence |
|------|--------|----------|
| **1. Pre-flight baseline** | PASS | `feat/launch-readiness` clean; `https://amadaflow-loyalty.fly.dev/health` → `200 {"ok":true,"db":"up"}`; `shopify app build` → "LoyaltyFlow built!"; Fly authed, 1 machine started + 1 auto-stopped (expected). |
| **9. Fly capacity (demo-scale)** | PASS | 40/40 `/health` → 200 (<2.3s); no OOM; `fly.toml` correct (min_machines_running=1, auto start/stop, 512MB/1 shared CPU). |
| **10. Privacy policy (draft)** | DRAFT committed | `docs/legal/privacy-policy.md` — grounded in real code. **Awaits your fill (see below).** |
| **7. Webhook HMAC (partial)** | PASS | All 5 webhook endpoints return **401** on valid-headers + invalid-HMAC (Shopify's compliance scenario). Subscription-registration check still pending the release (Task 12/6). |

Original "build errors in extensions" report: **not reproducible** — extensions build cleanly.
The real dev blocker earlier was protected-customer-data (fixed by you) then a stale store
session; dev now connects.

---

## ⛔ Remaining — all blocked on YOU (dashboard / content)

Do these in the Partner / dev dashboard, then ping Claude to run the dependent automation.

### Task 12 — Approve network access + release  ⭐ DO FIRST (unblocks 6 → 7 → 8)
- `shopify app deploy` created version **`loyaltyflow-2`** but **could not release** it.
- Reason: the 4 UI extensions declare `network_access = true` and need network access
  **requested + approved** before a version containing them can be published:
  `loyalty-checkout`, `loyalty-customer-account`, `loyalty-rewards-page`, `loyalty-order-rewards-page`.
- Version URL: <https://dev.shopify.com/dashboard/219804029/apps/375786864641/versions/996435001345>
- **Action:** approve network access for all 4 extensions, then either release `loyaltyflow-2`
  there, OR tell Claude and he re-runs `npx shopify app deploy`.
- Until released, the updated webhooks + privacy URLs are **staged, not live** (active version
  is still the 2026-06-02 one).

### Task 3 — Create Managed Pricing plans (fixes the pricing 404; unblocks Task 4)
- Partner Dashboard → Apps → LoyaltyFlow → **Managed pricing**:
  - **Free** — $0, no trial (soft-gate: 3 tiers / 3 rules).
  - **Pro** — $9.99 USD/mo recurring, **14-day trial** (unlimited).
- Then verify (browser, logged into dev store) that this no longer 404s:
  `https://admin.shopify.com/store/vic-test-rczyeeqw/charges/<handle>/pricing_plans`

### Task 2 — Confirm the app handle
- Read the app's real **handle** in the dashboard. If it's `loyaltyflow`, nothing to do.
- If different: Claude runs `flyctl secrets set SHOPIFY_APP_HANDLE=<handle> -a amadaflow-loyalty`
  so the in-app upgrade link resolves.

### Task 5 — Admin UI smoke test (browser)
- With `shopify app dev` running, open each: `/app`, `/app/customers`, `/app/reward-programs`,
  `/app/settings`. Toggle program Active/Paused (persists on reload) and save a tier edit.
- Report any error page/message to Claude. (Known cosmetic: `app.reward-programs.tsx`
  re-exports `app._index.tsx` — parked, no fix this week.)

### Task 10 fill — privacy policy content
Open `docs/legal/privacy-policy.md` and supply the `<<FILL: ...>>` markers:
1. **Legal entity name** (e.g. "Amada Flow …") — appears ~3×.
2. **Privacy contact email** — appears ~3×.
3. **Where it will be hosted** — the public **URL** is what Partners needs at submission.
Optional for legal review: add a governing-law/jurisdiction clause; note the Fly **`sin`
(Singapore)** data region for GDPR data-residency.

---

## ▶ What Claude runs automatically once you unblock

| After you do… | Claude runs | Verifies |
|---------------|-------------|----------|
| Task 12 (network access + release) | re-deploy / confirm release; Task 6, 7, 8 | new active version; subscriptions registered; trigger `orders/paid` + `refunds/create`, watch `flyctl logs` |
| Task 3 (pricing) | Task 4 | Free gate blocks 4th tier/rule; `getActivePlan` resolves cleanly |
| (all of the above) | Task 11 | final evidence sweep + update `HANDOFF.md` checklist + list remaining-to-submit |

---

## ⚠️ Open findings

- **Task 13 (parked):** `/api/public-loyalty-program` returns **HTTP 500**
  (`"Could not find a session for shop … when creating unauthenticated admin context"`)
  for shops with no stored session on the *production* Fly app. Resolves once the dev store
  installs the *released* app (Task 12). Consider making it return 4xx (not 500) for unknown
  shops before submission. (Code change — out of scope for the verify-only plan.)
- Live webhook/privacy **subscription registration** unconfirmed until `loyaltyflow-2` is released.

---

## How to resume tomorrow

1. `cd /Users/naspadstudio/Documents/GitHub/amadaflow-apps/loyalty-engine && git checkout feat/launch-readiness`
2. Tell Claude: *"continue launch-readiness — I've done Task 12 / Task 3 / …"* (whatever you completed).
3. Claude reads this file + the plan, runs the now-unblocked automation, and reports evidence.

**Task list IDs (for reference):** 1✅ 2⛔ 3⛔ 4(blk3) 5⛔ 6(blk12) 7(partial,blk6) 8(blk6)
9✅ 10(draft,awaiting fill) 11(blk all) 12⛔⭐ 13(parked).
