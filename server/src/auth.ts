import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@wallet/shared';
import { getDb } from './db.js';
import { env } from './env.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

interface UserRow {
  id: number;
  email: string | null;
  display_name: string | null;
  is_admin: number;
  fy_start_month: number;
  base_currency: string;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  isAdmin: !!r.is_admin,
  fyStartMonth: r.fy_start_month,
  baseCurrency: r.base_currency,
});

export const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex');

function provision(extSubject: string, email: string | null, name: string | null): User {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM users WHERE ext_subject = ?').get(extSubject) as unknown as
    | UserRow
    | undefined;
  if (existing) return toUser(existing);

  const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  // First user is admin (bootstrap); otherwise admin iff email is allow-listed.
  const isAdmin = count === 0 || (email !== null && env.adminEmails.includes(email.toLowerCase()));
  const info = db
    .prepare('INSERT INTO users(ext_subject, email, display_name, is_admin) VALUES(?, ?, ?, ?)')
    .run(extSubject, email, name, isAdmin ? 1 : 0);
  const row = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as unknown as UserRow;
  return toUser(row);
}

// Honor identity headers only when the immediate peer is a configured proxy,
// so a direct client can't forge Remote-User. "*" trusts any peer (dev only).
function peerTrusted(req: FastifyRequest): boolean {
  if (env.trustedProxies.includes('*')) return true;
  const ip = req.socket.remoteAddress ?? '';
  const norm = ip.replace(/^::ffff:/, ''); // IPv4-mapped IPv6
  return env.trustedProxies.includes(ip) || env.trustedProxies.includes(norm);
}

function firstHeader(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export async function authHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  // 1) Per-user API token (for VPN/PWA direct access; bypasses proxy trust).
  const authz = req.headers.authorization;
  if (authz?.startsWith('Bearer ')) {
    const row = getDb()
      .prepare('SELECT * FROM users WHERE api_token_hash = ?')
      .get(hashToken(authz.slice(7).trim())) as unknown as UserRow | undefined;
    if (row) {
      req.user = toUser(row);
      return;
    }
    return reply.code(401).send({ error: 'invalid_token' });
  }

  // 2) Forwarded identity from a trusted proxy (Authelia forward-auth).
  const subject = firstHeader(req.headers[env.headerUser]);
  if (subject && peerTrusted(req)) {
    req.user = provision(
      subject,
      firstHeader(req.headers[env.headerEmail]),
      firstHeader(req.headers[env.headerName]) ?? subject,
    );
    return;
  }

  // 3) Dev mock (local only). Fail closed: never honored once a trusted proxy is
  // configured, so a stray AUTH_DEV_USER in a real deployment can't override Authelia.
  if (env.devUser && env.trustedProxies.length === 0) {
    req.user = provision(env.devUser, env.devUserEmail ?? null, env.devUser);
    return;
  }

  return reply.code(401).send({ error: 'unauthenticated' });
}
