# Handoff — Wallet

## Where things stand
- **Branch**: `flow/wallet` (also fast-forwarded into `main`). No git remote yet.
- **Full spec**: [`specs/wallet.md`](specs/wallet.md) — all 7 phases, decisions fixed.
- **Gate record**: [`reviews/wallet.md`](reviews/wallet.md). **Journal**: [`journal.md`](journal.md).

## Done
- **Phase 0 — foundation** ✅ PASSED (`journal.md §1`). One container: Fastify + `/api` +
  PWA, `node:sqlite`, Authelia multi-user auth, non-root, loopback bind.
- **Phase 1 — core ledger (MVP)** ✅ PASSED (`journal.md §2`). Accounts/CC, categories
  (seeded taxonomy), transactions (signed cents), transfers (row + 2 mirror legs),
  dashboard (summary, account cards + CC utilization, category bars, recent). Tenant
  isolation DB-enforced (owner-scoped composite FKs) + service checks. Mobile PWA
  (React/Vite/Tailwind/TanStack Query). Live-verified in browser.
- **Phase 2 — car module** ✅ PASSED (`journal.md §3`). `vehicles` + `fuel_entries`
  (migration v3; integers only — ml/km/cents). `computeFuelStats` (car.ts, pure + tested):
  L/100km over full-fill intervals w/ partial-fill accumulation, €/L, €/km, monthly car
  spend. Car tab (4th): tiles + CSS-bar trends + monthly split + fuel log. Categories got a
  stable `system_key` (migration v4) so "Car" survives a rename. 12/12 tests; live-verified.
- **Phase 3 — recurring & predictions** ✅ PASSED (`journal.md §4`). `recurring_rules`
  (migration v5). `recurring.ts` pure core (tested): `occurrencesBetween` (month-end clamp +
  yearly), `projectForecast` (rules + 6-mo avg, no double-count), `detectRecurring`.
  Idempotent auto-post (external_ref `recur:<id>:<date>` + `last_posted_date`), fires on app
  open. Plan tab (5th): forecast bars, suggestions w/ prefill, upcoming, rules. 20/20 tests.

## Phase 5 — receipt capture (photo + OCR) (COMMITTED on `flow/wallet`, NOT yet on `main`)
Built this session (journal `§6`), gate green (typecheck/lint/**36 tests**/build/`docker compose
build`), **CodeRabbit 0 findings** (3 major fixed: tendered-amount-as-total, image route keyed on
tx id, dropped unused `note`; 1 deferred: self-host OCR assets — no user data leaves). Held back
from `main` pending the manual browser smoke test below (same `file_upload` limitation as Phase 4).
- migration **v7**: `receipts` (image BLOB, ocr_text, parsed_json) + UNIQUE index on
  `transactions(user_id,id)`; receipt cascades when its transaction is deleted.
- `shared/receipt.ts` (+ `receipt.test.ts`): pure `parseReceipt` (total/date/merchant) + `parseMoney`.
- `server/src/receipts.ts` (+ route `POST /api/receipts`, `GET /api/receipts/by-tx/:id/image`),
  atomic tx+receipt insert; Fastify `bodyLimit` 16 MB.
- `web/src/lib/ocr.ts` (downscale + Tesseract `por+eng`), `ReceiptCapture.tsx`, camera FAB.
- **QR path dropped** (spec 2026-07-23). `tesseract.js` added to web.

### To finish Phase 5
1. ✅ CodeRabbit — clean (0 findings).
2. **Manual browser smoke test** (no `file_upload` on the agent surface): open the app → tap the
   📷 FAB → pick/snap a receipt → wait for OCR → confirm the draft prefilled the total (IVA-incl.),
   date, merchant (or shows the "couldn't read" hint) → Save → check the transaction + balance.
   Deleting that transaction should drop its receipt.
3. **Merge to `main`**: `git switch main && git merge --ff-only flow/wallet`.
4. Optional later: self-host Tesseract assets (+ CSP); show a receipt thumbnail on the tx row.

## Phase 4 — bank import (MERGED to `main` @ `a442c6e`)
Built this session (journal `§5`), gate green (typecheck/lint/**29 tests**/build), **CodeRabbit
0 findings** (2 major + 2 minor fixed: category-ownership validation, O(n) dedup index,
IBAN/spaced-NIB ref, pdf.js `doc.destroy`). Committed but **held back from `main`** pending the
manual browser smoke test below.
- migration **v6**: `bank_imports` + `transactions.import_id` (ON DELETE CASCADE → reversible).
- `server/src/bank.ts` (+ `bank.test.ts`): pure dedup (exact ref + fuzzy ±1 day), synthesized
  refs, merchant memory; preview/commit/list/revert. All 4 DoD cases tested.
- `shared/parsers.ts` (+ `parsers.test.ts`): pluggable bank registry, **CGD** parser.
  Validated on the real 123-row June statement (amounts reconcile to the account total).
- `web/src/lib/extractPdf.ts` (pdf.js in a worker), `ImportFlow.tsx`, Manage "Import PDF" +
  Undo list. `pdfjs-dist` added to web.

Phase 4 passed its manual smoke test and merged to `main` (§4/§5 done). Optional later:
opening-balance regex on the real CGD layout; generic CSV path; more banks. **Do not commit the
real statement or its data** — only the synthetic fixture in `shared/parsers.test.ts`.

## Next (after Phase 5)
- Phase 6: Statistics, insights & data portability (trends, YoY, investments, debt, export/import).

## Gate commands (must pass before a phase lands)
```
npm run typecheck && npm run lint && npm test && npm run build
docker compose build            # + `docker compose up` for integration phases
# CodeRabbit (Debian WSL, CLI 0.7.0):
wsl -d Debian -e sh -lc "cd /mnt/c/Users/nunob/Repositorios/Wallet && coderabbit review --uncommitted --include-untracked --base main"
```

## Resume line
Open a new session in this repo, say **resume flow**; read `handoff.md` +
`specs/wallet.md` + the `journal.md` tail. **Phase 5 is committed on `flow/wallet`,
CodeRabbit-clean, but NOT on `main`** — do the manual browser smoke test (📷 FAB → snap receipt →
confirm draft → Save), merge to `main`, then move to Phase 6 (stats, insights & data portability).

## Gotchas (this machine)
- Node 25 local; `node:sqlite` loaded via `createRequire` so Vite/vitest don't choke.
- CodeRabbit CLI is in **Debian WSL** (0.7.0 syntax: `--uncommitted --include-untracked
  --base main`), needs a valid `HEAD` and a base branch (`main` exists).
- Docker Desktop may need starting; daemon at `npipe:////./pipe/dockerDesktopLinuxEngine`.
