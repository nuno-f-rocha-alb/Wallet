function list(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const env = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? './data/wallet.db',
  webDir: process.env.WEB_DIR, // resolved in index.ts if unset

  // Identity headers set by the trusted reverse proxy (Authelia forward-auth).
  headerUser: (process.env.AUTH_HEADER_USER ?? 'remote-user').toLowerCase(),
  headerEmail: (process.env.AUTH_HEADER_EMAIL ?? 'remote-email').toLowerCase(),
  headerName: (process.env.AUTH_HEADER_NAME ?? 'remote-name').toLowerCase(),

  // Only these peer IPs may set identity headers. "*" = trust any (DEV ONLY).
  trustedProxies: list(process.env.TRUSTED_PROXIES),
  adminEmails: list(process.env.ADMIN_EMAILS).map((s) => s.toLowerCase()),

  // Local/no-Authelia mock: forces every request to this subject. Honored ONLY
  // when no trusted proxy is configured (i.e. not a real deployment) — see auth.ts.
  devUser: process.env.AUTH_DEV_USER || undefined,
  devUserEmail: process.env.AUTH_DEV_EMAIL || undefined,

  version: process.env.APP_VERSION ?? '0.0.0',
};
