# Wallet

Self-hosted, multi-user personal-finance PWA. Mobile-first, installable, runs as a
single Docker container behind your own reverse proxy + [Authelia](https://www.authelia.com/).

Built in phases against [`specs/wallet.md`](specs/wallet.md). **Phase 0 (foundation)
is done**: container, SQLite, multi-user auth, installable PWA shell.

## Stack
- **One container**: Node + Fastify serves the JSON API (`/api/*`) and the built PWA.
- **SQLite** via the built-in `node:sqlite` — no native module, no separate DB.
- **Auth**: Authelia forward-auth in front. The app stores **no passwords**; it trusts
  the identity header from your proxy, auto-provisions a user, and scopes all data by
  user. A per-user API token covers direct/VPN/PWA access.
- **Web**: React + Vite PWA (`vite-plugin-pwa`).

## Run it

```bash
docker compose up -d --build
```

Then put it behind your reverse proxy with Authelia forward-auth, and set
`TRUSTED_PROXIES` to the proxy's IP so identity headers are honored. See
[`.env.example`](.env.example) for all settings.

**Local testing without Authelia** — mock an identity:

```bash
AUTH_DEV_USER=me AUTH_DEV_EMAIL=me@example.com docker compose up -d --build
```

Open http://localhost:8080. The first user provisioned is admin.

## Develop

```bash
npm install
npm run dev:server   # Fastify on :8080  (set AUTH_DEV_USER to mock auth)
npm run dev:web      # Vite on :5173, proxies /api → :8080
```

Gate (must pass before a phase lands):

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

## Security notes
- Identity headers are honored **only** when the direct peer's IP is in
  `TRUSTED_PROXIES`. With it empty, headers are ignored (safe). Trusting a direct
  client — or using `*` — lets it forge `Remote-User`; `*` is DEV ONLY.
- `AUTH_DEV_USER` is ignored whenever `TRUSTED_PROXIES` is set, so it can't override
  Authelia in a real deployment.
- Data is isolated per user. Sharing/household budgets are a future phase.
