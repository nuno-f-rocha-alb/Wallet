# Wallet — personal finance PWA (full spec)

Self-hosted, multi-user personal-finance web app. Mobile-first PWA + desktop.
Modeled on the "Personal finances.xlsx" a friend built (categories, car fuel
stats, income, debt, summary) but rebuilt as **one transactions store + one fuel
log + recurring rules**, deriving all summaries/stats/predictions by query.

Status: **full spec upfront**, built **phase by phase**. Each phase ships a
working, deployable app and must pass the objective gate (§ Gate) before landing.

---

## 0. Decisions (fixed — do not re-litigate mid-build)

- **Deploy**: single Docker image on the user's Docker server; reachable via VPN
  or public URL. `docker compose up` is the whole thing.
- **Backend**: Node + TypeScript, **Fastify**, serves JSON API under `/api/*`
  **and** the built PWA static files from the same process/container.
- **DB**: **SQLite** (`better-sqlite3`), single file on a mounted volume. No
  separate DB container. (ponytail: single-user-per-row workload; Postgres only
  if concurrency ever demands it.)
- **Auth**: **Authelia forward-auth** in front (user runs it on their VPS). App
  does **no password handling**. It reads the authenticated identity from a
  configurable trusted header (default `Remote-User`, plus `Remote-Email`,
  `Remote-Groups`), auto-provisions a `users` row on first request, and stamps
  `user_id` on every domain row. **Multi-user**: each user sees only their own
  data. A per-user **API token** (bearer) is the fallback for direct/VPN/PWA
  access that doesn't traverse Authelia. Trusted-proxy IP allowlist so the header
  can't be spoofed from outside.
- **Admin**: the first provisioned user, or an email in `ADMIN_EMAILS`, is admin
  (can list users, issue/revoke tokens). No other RBAC. (ponytail.)
- **Sharing model**: **isolated per-user** now. Shared "household" grouping =
  deferred additive phase (§ Deferred), not built until asked.
- **Frontend**: React + Vite + TypeScript, **installable PWA** (`vite-plugin-pwa`
  — manifest + service worker), mobile-first, `react-router`, **TanStack Query**
  for data/caching, **Recharts** for charts. (Alternatives noted; not swapping
  without cause.)
- **Money**: integer **cents**, signed (`-` expense, `+` income). Currency **EUR**
  default, stored per account; UI **English**; dates ISO `YYYY-MM-DD`.
- **Fiscal year**: start month **configurable per user**, default January
  (calendar). Friend's sheet used Feb→Jan — supported via config, not hard-coded.
- **Offline**: PWA installable + service worker caches app shell and last-loaded
  reads. **Offline *writes* (queue + sync) are deferred** (§ Deferred) — the app
  is online-first because data lives on the server. Flagged with a `ponytail:`
  comment where the seam is.
- **OCR / parsing**: fully **on-device**. Receipts: **read the Portuguese AT QR
  code first** (see below), Tesseract.js OCR only as fallback. Bank statements:
  in-browser CSV + `pdf.js`. No API keys, nothing leaves the device except the
  transaction rows saved to the user's own server.
- **PT receipt QR (AT / Decreto-Lei 28/2019, mandatory since 2022)**: the QR is a
  **plain-text** payload, fields joined by `*` as `LETTER:value` — readable by any
  QR lib in-browser, *not* Finanças-only, not encrypted. Fields we use:
  `A`=merchant NIF, `F`=date `YYYYMMDD`, `O`=total incl. tax (cents after ×100),
  `D`=doc type, `H`=ATCUD, `N`=total VAT, `B`=buyer NIF. Parse gives exact
  total/date/merchant — no OCR guessing.

---

## 1. Data model (SQLite; every domain table has `user_id`)

- **users**(id, ext_subject UNIQUE, email, display_name, is_admin, api_token_hash,
  fy_start_month, base_currency, created_at)
- **accounts**(id, user_id, name, type[`cash`|`bank`|`credit_card`|`loan`],
  currency, opening_balance_cents, credit_limit_cents NULL, archived, sort)
- **categories**(id, user_id, name, parent_id NULL, kind[`expense`|`income`],
  color, icon, archived) — seeded per user from the xlsx taxonomy (§ Seed).
- **transactions**(id, user_id, date, amount_cents SIGNED, account_id,
  category_id NULL, description, note NULL, source[`manual`|`receipt`|`bank`|
  `recurring`], external_ref NULL, transfer_id NULL, created_at) — indices on
  (user_id,date), (user_id,account_id), (user_id,external_ref).
- **transfers**(id, user_id, date, from_account_id, to_account_id, amount_cents,
  note) — also models **credit-card payments** and loan repayments. Rendered as a
  linked pair; stored once here + two mirror transactions carrying `transfer_id`.
- **vehicles**(id, user_id, name, plate NULL, initial_odometer_km)
- **fuel_entries**(id, user_id, vehicle_id, date, odometer_km, liters,
  total_price_cents, partial_fill BOOL, transaction_id NULL) — only fuel needs its
  own table (liters/km). Other car costs (tax, insurance, repairs, reimbursements)
  are ordinary transactions in Car subcategories.
- **recurring_rules**(id, user_id, label, amount_cents SIGNED, account_id,
  category_id NULL, cadence_kind[`monthly_day`|`weekly`|`interval_days`|`yearly`],
  cadence_value, next_date, end_date NULL, auto_post BOOL, source_detected BOOL)
- **receipts**(id, user_id, transaction_id NULL, image_path, ocr_text, parsed_json,
  created_at)
- **import_batches**(id, user_id, source, filename, imported_at, added_count,
  skipped_count) + **import_staging**(batch_id, raw_json, parsed fields, dup BOOL)
- **settings** folded into `users` where per-user; a tiny `app_meta` kv for
  migration version.

Migrations: numbered `NNN_name.sql` run by a ~30-line runner. No migration
framework. (ponytail.)

### Seed taxonomy (from the xlsx, per new user)
Expense: Housing; Food & Drinks › {Groceries, Eating out}; Car › {Fuel, Road tax,
Insurance, Repairs, Reimbursement, Other}; Subscriptions; Flights; Other.
Income: Salary; Business; Investments; Other.

---

## 2. Derived (queries/services — NOT stored)

Monthly totals per category & per account; income vs expense, net, savings rate;
account balances (opening + Σ transactions); credit-card balance vs limit; car
L/100km (odometer deltas, skipping partial fills), €/L, €/km, €/month; cashflow
forecast (recurring + category averages projected N months); recurring-pattern
detection from history; fiscal-year rollups (configurable start month).

---

## 3. Phases (each is a build⇆gate unit; journal `§N` per phase)

### Phase 0 — Foundation & deploy skeleton
Monorepo (`server/`, `web/`, `shared/`). Fastify serving a stub installable
PWA + `/api/health`. SQLite init + migration runner. **Auth middleware**:
trusted-proxy check → identity from header → auto-provision user → `req.user`;
bearer-token path; admin flag. Dockerfile (multi-stage) + `docker-compose.yml`
(volume for SQLite, env for header name/trusted proxies/admin emails/port).
**DoD**: `docker compose up` serves the installable PWA behind a mocked auth
header; `/api/health` → 200; a second identity provisions a second isolated user;
SQLite persists across container restart.

### Phase 1 — Core ledger (MVP)
Accounts CRUD (incl. credit cards w/ limit). Categories CRUD (seeded). Transactions
CRUD (income/expense, signed) with mobile quick-add. Transfers (incl. CC payments).
Dashboard: current-month income/expense/net, per-category breakdown, account
balances + CC utilization, basic charts. All API routes user-scoped + zod-validated.
**DoD**: create/edit/delete transactions, accounts, transfers; balances &
dashboard totals match a seeded fixture (unit test on the balance/rollup service);
two users' data never cross (integration test); live-verify: rendered dashboard
DOM shows correct totals for the fixture.

### Phase 2 — Car module
Vehicles CRUD. Fuel-log entry (date, odometer, liters, total price). Derived
**L/100km** (consecutive full-fill odometer deltas; partial fills accumulate into
the next full fill), **€/L**, **€/km**, monthly car spend (fuel + Car-category
costs − reimbursements). Car stats screen + charts (L/100km trend, €/L trend, cost
split). **DoD**: fixture fuel log → L/100km, €/L, €/km match hand-computed values
(unit test incl. a partial-fill case); stats screen renders them.

### Phase 3 — Recurring & predictions
Recurring-rule CRUD ("on day X, Y€ from account Z, category C"), with month-end
clamping (e.g. day 31 in Feb). Upcoming/calendar view; optional **auto-post** on
due date (idempotent, catch-up on app open). Cashflow **forecast**: project account
balances N months forward from recurring rules + per-category historical averages.
**Pattern detection**: scan history for repeated merchant/amount/cadence and
suggest rules. **DoD**: next-date generation correct incl. month-end & yearly
(unit test); forecast endpoint returns projected month-end balances for a fixture;
detector recovers a known recurring series from fixture history; auto-post is
idempotent (running twice makes one transaction).

### Phase 4 — Bank statement import & sync
Upload **CSV** (column-mapping UI, remembered per bank) or **PDF** (`pdf.js` text
extraction → row heuristics). Stage → **dedup** vs existing (date + amount +
normalized description/`external_ref`, fuzzy within a day window) so re-importing
overlapping months inserts only the **missing** rows at the correct date.
Auto-categorize via merchant memory. Review-and-confirm before commit; batch is
reversible. **DoD**: importing the same fixture statement **twice** yields zero
duplicates; a statement overlapping existing data inserts only new rows; parser
handles a sample PT bank CSV; category memory reapplies a prior mapping.

### Phase 5 — Receipt capture (photo + OCR)
Camera capture / file import → **Tesseract.js** OCR in-browser → heuristics for
**total, date, merchant** → prefilled draft transaction for confirmation → image
stored + linked (`receipts`).
**QR path dropped** (user decision, 2026-07-23): the PT AT receipt QR carries only
totals (with/without IVA) + date + merchant NIF — **no article/line-item names** — so
it adds no value a transaction needs beyond the total, which OCR already gets. Kept as
an optional later add only if OCR totals prove unreliable.
**Canonical total**: the **IVA-inclusive grand total** (what was actually paid), stored
as integer cents. OCR only *prefills* a draft the user confirms before commit — there is
no silent tolerance; the committed amount is whatever the user confirms. The parser's
suggested total is accepted into the draft only if it parses to a value within **±1 cent**
of a total-like line; otherwise the amount is left blank for manual entry.
**DoD**: a sample receipt image prefills, into a draft transaction the user confirms:
(a) the IVA-inclusive **total** (±1 cent), (b) the **date** (parsed to `YYYY-MM-DD`, else
left as today), and (c) a **merchant** string into the description (else left blank);
image persisted + linked; graceful "couldn't read, enter manually" fallback when a field
isn't found.

### Phase 6 — Statistics, insights & data portability
Trends, YoY, savings rate, category drilldown, fiscal-year view (configurable
start). Investment tracking (buys/sells, realized P/L, DCA — as in the xlsx). Debt
tracker (credit-card / loan payoff, installment plan à la "emergency fund").
**Export/Import** full backup (JSON) + CSV export. **DoD**: stats match fixtures;
export→wipe→import round-trips identically (integration test).

---

## 4. Cross-cutting (every phase)

- Validation with **zod** at the API boundary; reject unknown/invalid input.
- Every query filtered by `req.user.id`; no cross-user leakage (asserted in tests).
- Trusted-proxy enforcement so identity headers can't be forged externally.
- Money math only in integer cents; never float euros in logic.
- a11y basics (labels, focus, contrast); mobile-first responsive; light/dark.
- One runnable check per non-trivial unit (balances, L/100km, recurrence dates,
  dedup, forecast) — vitest, no heavy fixtures/frameworks.

---

## 5. Gate (objective definition of done — per phase)

All must be green before a phase lands on `main`:
1. `npm run typecheck` (tsc `--noEmit`, server + web) — clean.
2. `npm run lint` (eslint) — clean.
3. `npm test` (vitest) — the phase's self-checks + prior phases' pass.
4. `npm run build` (server + web) — clean.
5. **Docker**: `docker compose build` succeeds; for Phase 0 + integration-
   touching phases, `docker compose up` health check green.
6. **Live-verify**: run the artifact, assert on real output (rendered DOM for
   screens, HTTP response for endpoints, computed values for stats). Not "it
   compiled."
7. **CodeRabbit** on changed code/infra (skip only doc-only edits). Fix Critical +
   clearly-relevant; defer rest with a one-word reason.

Iteration cap: 4 build⇆gate loops per phase; no-improvement guard; never weaken
spec or gate to force a pass.

---

## 6. Deferred (explicitly NOT now — build only when asked)

- Shared **household**/joint budgets (multi-user *shared* data; today is isolated).
- **Offline writes** (local queue + sync + conflict resolution).
- Cloud **AI** OCR/parsing (on-device only for now).
- Native mobile app (PWA covers it).
- In-app auth/passwords (Authelia owns this — build only if they drop Authelia).
- Multi-currency conversion/FX (per-account currency stored; no cross-currency
  rollup math yet).
