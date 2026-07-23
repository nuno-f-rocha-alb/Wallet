# Gate record — Wallet

One section per phase. PASS only when every requirement is MET and the gate is clean.

---

## Phase 0 — foundation & deploy skeleton

### Requirements (from specs/wallet.md § Phase 0)
| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Monorepo (server/web/shared) + Fastify serving PWA + `/api/health` | MET | build ✓; `/api/health`→`{status:ok}` |
| 2 | SQLite init + migration runner | MET | `node:sqlite`, WAL, inlined migration v1; boots clean |
| 3 | Auth middleware: trusted-proxy → header identity → provision; bearer path; admin | MET | 401 without auth; alice/bob provisioned; token path in `auth.ts` |
| 4 | `docker compose up` serves installable PWA behind mocked auth | MET | container healthy; root 200; manifest+SW served |
| 5 | Second identity provisions a second isolated user | MET | alice→id1 admin, bob→id2 non-admin |
| 6 | SQLite persists across container restart | MET | after `docker restart`, alice still id1 |

### Gate commands
| Check | Result |
|-------|--------|
| `npm run typecheck` | ✓ clean |
| `npm run lint` | ✓ clean |
| `npm test` (vitest) | ✓ 3/3 |
| `npm run build` | ✓ web PWA + server |
| `docker compose build` | ✓ |
| `docker compose up` health | ✓ healthy |
| Live-verify (in-container curl) | ✓ health/isolation/persistence |
| CodeRabbit (`-t uncommitted`) | see below |

### CodeRabbit findings (iteration 1 → all fixed)
1 critical, 7 major, 6 minor — all addressed:
- **critical** @fastify/static in CVE-2026-6414 range → bumped to ^9.1.1 (installed 9.3.0).
- **major** URL-string `/api/` auth gate bypassable via `%2F` → replaced with a
  route-scoped auth plugin (verified: `/%61pi/me` → 401, no bypass).
- **major** dev-auth could override Authelia in prod → `AUTH_DEV_USER` ignored whenever
  `TRUSTED_PROXIES` is set (+ boot warning).
- **major** compose published `8080` on all interfaces → bound to `127.0.0.1`.
- **major** container ran as root → `USER node` + `chown node:node /data` (verified uid 1000).
- **major** `.env` could enter Docker build context → excluded in `.dockerignore`.
- **major** `.claude/settings.local.json` (broad perms) → gitignored; was never tracked.
- **minor** safe-area insets; icon-script CWD independence; README trusted-proxy wording;
  spec `shared/types/`→`shared/`; raw review output gitignored; this verdict finalized.

### Gate re-run after fixes
typecheck ✓ · lint ✓ · vitest 3/3 ✓ · build ✓ · docker build ✓ · container healthy as
non-root (uid 1000) ✓ · isolation + persistence + no-bypass re-verified ✓.

CodeRabbit re-review: **0 findings on shippable code.** The only 2 findings pointed at
the raw `reviews/cr-*.txt` scratch logs (stale text from the prior review, e.g. the old
`^8.0.3` string) — not the source. Those gitignored scratch files were deleted; the
distilled record lives here.

### Verdict: PASS

---

## Phase 1 — core ledger (MVP)

### Requirements (from specs/wallet.md § Phase 1)
| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Accounts CRUD incl. credit cards w/ limit | MET | routes + form; CC utilization bar renders |
| 2 | Categories CRUD, seeded taxonomy | MET | seed on provision; Manage shows full tree; test |
| 3 | Transactions CRUD (signed) + mobile quick-add | MET | FAB→form; live-verified −42.50 expense |
| 4 | Transfers (incl. CC payments) | MET | transfer row + 2 legs; delete reverts (test) |
| 5 | Dashboard: month income/expense/net, per-category, balances + CC util | MET | live screenshot; excludes transfer legs (test) |
| 6 | All routes user-scoped + zod-validated | MET | isolation test; bad input → 400 test |

### Gate commands
| Check | Result |
|-------|--------|
| `npm run typecheck` | ✓ clean |
| `npm run lint` | ✓ clean |
| `npm test` (vitest) | ✓ 8/8 (3 auth + 5 ledger) |
| `npm run build` | ✓ web PWA + server |
| Live-verify (browser, mobile) | ✓ account→balance 1500; −42.50 expense→1457.50; dashboard + category bar + recent updated live; Manage taxonomy; transfer hidden <2 accts |
| CodeRabbit | see below |

### CodeRabbit findings (2 iterations)
**Iteration 1** (2 major, 4 minor) — all fixed:
- major: category `parentId` unvalidated → `assertParentCategory` (existence + ownership +
  no self-parent), tested.
- major: FKs validated only `id` → owner-scoped composite `UNIQUE(user_id,id)` + composite
  FKs on every cross-table reference (tenant isolation now DB-enforced).
- minor: transfer/tx amount `min="0"` allowed silent zero → `min="0.01"` + guards.
- minor: FAB aria-label wrong when opening Add-account → dynamic label.
- minor: `node:sqlite` RC → `engines: node>=24` (image already pinned node:24).
- minor: spec Phase 5 OCR tolerance undefined → defined (IVA-inclusive total, ±1 cent).

**Iteration 2** (1 major, 4 minor):
- major: transfers allowed non-positive / same-account → DB `CHECK(amount_cents>0)` +
  `CHECK(from_account_id <> to_account_id)`. **Fixed.**
- minor: Phase 5 DoD missed date+merchant → added acceptance for both. **Fixed.**
- minor: this record was stale/empty → finalized (here). **Fixed.**
- minor: test env not restored in teardown → `finally`-restore. **Fixed.**
- minor: tests share ordered state → **Deferred** (intentional: sequential integration
  flow over one shared DB; vitest preserves in-file order and isolates files).

### Verdict: PASS (1 minor deferred with reason above)

---

## Phase 2 — car module

### Requirements (from specs/wallet.md § Phase 2)
| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Vehicles CRUD | MET | routes + `VehicleForm`; delete blocked (409) while entries exist → archive |
| 2 | Fuel-log entry (date, odometer, litres, total price) | MET | `fuel_entries` (ml/cents/km integers); `FuelForm`; full/partial flag |
| 3 | L/100km (consecutive full-fill deltas; partials accumulate) | MET | `computeFuelStats` unit test w/ partial-fill = 8.0 (hand-computed) |
| 4 | €/L and €/km | MET | per-fill €/L + interval-aggregate €/L 1.875 / €/km 0.15 asserted |
| 5 | Monthly car spend (fuel + Car-cat costs − reimbursements) | MET | `monthlyCosts`; Car category by stable `system_key`, not name |
| 6 | Car stats screen + charts (L/100km, €/L, cost split) | MET | `Car.tsx`: tiles + CSS-bar trends + monthly split; live-verified |
| 7 | All routes user-scoped + zod-validated | MET | isolation test (bob→404/400); bad input + impossible-date → 400 |

### Gate commands
| Check | Result |
|-------|--------|
| `npm run typecheck` | ✓ clean |
| `npm run lint` | ✓ clean |
| `npm test` (vitest) | ✓ 12/12 (3 auth + 6 ledger + 3 car) |
| `npm run build` | ✓ web PWA + server |
| Live-verify (endpoint) | ✓ `/vehicles/:id/stats` → L/100km 8, €/L 1.5, €/km 0.12, monthly fuel €120 |
| Live-verify (browser) | ✓ Car tab: tiles, L/100km + €/L trends, monthly split, fuel log w/ partial label |
| CodeRabbit | see below |

### CodeRabbit findings (iteration 1 → all fixed)
1 major, 4 minor — all addressed:
- **major** Car category matched by mutable `name` → a rename silently drops non-fuel
  costs/reimbursements from `monthlyCosts` → added stable `system_key` (migration v4 +
  backfill by name; seed sets `key:'car'`); `carCategoryIds` queries `system_key='car'`.
- **minor** DoD test used €1.50/L on every fill → a per-fill/aggregate €/L mix-up would
  still pass → closing fill now €2.00/L (aggregate 1.875), both asserted independently.
- **minor** `date` regex accepted `2026-02-31` → hardened the shared `date` schema with a
  calendar-validity refine (covers transactions/transfers too); impossible-date test added.
- **minor** month nav rendered on the Car tab though Car ignores month → `showMonthNav`
  restricted to dashboard/transactions.
- **minor** "reimbursed" legend had no bar segment → dropped the orphan legend (the bar is
  gross fuel+other; the total nets reimbursements, noted inline).

### Gate re-run after fixes
typecheck ✓ · lint ✓ · vitest 12/12 ✓ · build ✓. CodeRabbit re-review: **0 code findings**
(the 5 above all resolved). The only 2 findings flagged this record vs `journal.md` as
temporarily inconsistent (PENDING vs "Next: Phase 3") — resolved by this PASS.

### Verdict: PASS
