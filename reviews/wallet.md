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
