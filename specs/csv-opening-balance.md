# Feature spec — reconcile account balance from a CSV statement's running-balance column

Status: **not started.** Build this in a fresh session with `/flow` (or directly). Same gate as
every other change (typecheck · lint · test · build · docker · live-verify · CodeRabbit).

## Why

Wallet's balance = `opening_balance + Σ transactions`. A CSV statement carries transactions but
**not** the balance the account started from, so after a CSV import the balance is off by exactly
that missing opening amount (real case: bank showed €85.96, Wallet showed €64.03 — €22.78 of the
gap was the un-set opening balance; the user had to compute and enter it by hand).

Portuguese bank CSVs (CGD "Consulta de movimentos") include a **running-balance column**
("Saldo contabilístico após movimento"). Read it and set the account's opening balance
automatically so every CSV import reconciles to the bank.

## The reconciliation (the core idea — get this right)

The statement's **latest running balance** is the account's true current book balance
(the *newest* row's balance). After importing, we want:

```
opening + Σ(all account transactions)  ==  statementLatestBalance
```

So, **after** inserting the import rows, adjust the opening balance by the gap:

```
newOpening = currentOpening + (statementLatestBalance − currentWalletBalanceAfterImport)
```

This is robust: it works whether the account is fresh or already had transactions, and it's
independent of how many rows dedup skipped (we target the final balance, not the row count).

`statementLatestBalance` = the running balance of the most-recent row. CGD exports **newest-first**,
so it's the **first data row's** balance. Be defensive: also derive opening from the oldest row
(`oldestRow.balance − oldestRow.amount`) OR check `firstRowBalance − Σ(all amounts)` agrees within
±1 cent. If they disagree, the balance column was likely mis-mapped or the file re-ordered — do
**not** silently apply; surface it and let the user proceed without reconciling.

## Where the code is (current state, verified this session)

- **`shared/csv.ts`** — `parseCsv`, `guessMapping(header)`, `rowsFromCsv(table, mapping)`,
  `toIsoDate`, and `parseAmountCell` (use this to parse balance cells — handles PT/EN money).
  `CsvMapping = { date; amount; description; invertSign?; skipRows? }`.
- **`shared/csv.test.ts`** — unit tests for the above (mirror the style).
- **`web/src/components/ImportFlow.tsx`** — the import modal. CSV path: `parseCsv` → **`map`** step
  (column selects, built by `colSelect(...)`) → `onMappingConfirmed` → `rowsFromCsv` → `stage()`
  (calls `/api/import/preview`) → `review` → `doCommit()` (calls `/api/import/commit`).
- **`server/src/bank.ts`** — `previewImport`, `commitImport`. Commit inserts rows under one
  transaction, dedups against pre-existing only (see the recent fix), returns `CommitResult`.
- **`server/src/schemas.ts`** — `importCommit` zod schema (`accountId`, `source`, `description`,
  `rows`). `cents = z.number().int()`.
- Accounts already have `opening_balance_cents`; `PATCH /api/accounts/:id` accepts
  `openingBalanceCents` (see `ACCOUNT_COLS` / `accountUpdate`).

## Build

1. **`shared/csv.ts`**
   - `CsvMapping` gains optional `balance?: number` (column index, `-1`/absent = none).
   - `guessMapping` detects it: header hints `/^(saldo|balance|saldo\s*cont)/i`.
   - Add `statementEndBalanceCents(table, mapping): number | null` — parses the newest row's
     balance cell via `parseAmountCell`, returns null if no balance column or unparseable.
   - Add a consistency check helper (returns whether `firstBalance − Σamounts` ==
     `oldestBalance − oldestAmount` within 1 cent) so the UI can decide whether to offer reconcile.
   - Tests in `shared/csv.test.ts` for detection, end-balance parse, and the consistency check
     (incl. a deliberately-inconsistent fixture → not reconcilable).

2. **Server** — fold reconcile into commit (atomic, dedup-proof):
   - `importCommit` schema: add `reconcileToBalanceCents: cents.nullable().default(null)`.
   - `commitImport`: after the insert loop and before COMMIT, if `reconcileToBalanceCents != null`,
     read the account's current balance (`opening + Σ transactions` for that account/user) and
     `UPDATE accounts SET opening_balance_cents = opening_balance_cents + (target − currentBalance)`.
     Return the applied opening in `CommitResult` (add a field, optional) so the UI can confirm.
   - `bank.test.ts` integration: import a small statement with `reconcileToBalanceCents` → assert
     `GET /api/accounts` balance == target, for both a fresh account and one with a prior tx.

3. **Web — `ImportFlow.tsx`**
   - In the `map` step, add a **"Balance column"** select (optional) alongside date/amount/desc,
     pre-filled from `guessMapping`.
   - When a balance column is chosen, compute `statementEndBalanceCents` + the consistency check.
     If consistent, show a checkbox on the review step: **"Match my bank's balance (€85.96)"**
     (default on). If inconsistent, hide the checkbox and show a subtle note.
   - `doCommit()` passes `reconcileToBalanceCents` (the parsed end balance) when the box is ticked.
   - `web/src/api.ts`: `useCommitImport` body type gains `reconcileToBalanceCents?: number | null`.

## Definition of done (objective)

- A CGD-style CSV with a Saldo column imports and, with the box ticked, the account balance in
  Wallet equals the statement's latest balance **to the cent** (live-verify against the real
  `~/Documents/Consulta de movimentos-*.csv`, e.g. → €85.96).
- Works for a fresh account and one with prior transactions (opening adjusts by the delta).
- An inconsistent/mis-mapped balance column does **not** silently change the opening balance.
- Unit tests for the csv helpers; one server integration test for reconcile.

## Gotchas

- CGD CSV is **newest-first**, `;`-delimited, PT money (`85,96`). `parseCsv` auto-detects the
  delimiter; `parseAmountCell` handles the money. Date column is "Data mov." (col 0) — `guessMapping`
  already picks the first `data…` header.
- Only bank/cash accounts matter here (loans use a negative opening — out of scope).
- Don't confuse this with the bank's **available** balance (holds/captive amounts) — that's the
  separate deferred idea; this reconciles to the **book** balance ("Saldo contabilístico").
- Migrations are append-only in `server/src/db.ts` — this feature needs **no** new table/migration
  (reuses `opening_balance_cents`).
- CodeRabbit CLI: `wsl -d Debian -e sh -lc "cd /mnt/c/Users/nunob/Repositorios/Wallet && coderabbit review --uncommitted --include-untracked --base main"` (free-tier cap resets ~20 min; run a delayed retry in the background if hit).
