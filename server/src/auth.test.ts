import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wallet-'));
  process.env.DB_PATH = join(dir, 'test.db');
  process.env.TRUSTED_PROXIES = '*'; // accept identity headers in-test
  process.env.AUTH_DEV_USER = '';
  const mod = await import('./index.js');
  app = await mod.buildApp();
});

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test('health is public', async () => {
  const r = await app.inject({ url: '/api/health' });
  expect(r.statusCode).toBe(200);
  expect(r.json().status).toBe('ok');
});

test('/api/me rejects unauthenticated', async () => {
  const r = await app.inject({ url: '/api/me' });
  expect(r.statusCode).toBe(401);
});

test('provisions distinct, isolated users per identity; first is admin', async () => {
  const a = await app.inject({
    url: '/api/me',
    headers: { 'remote-user': 'alice', 'remote-email': 'a@x.pt' },
  });
  const b = await app.inject({
    url: '/api/me',
    headers: { 'remote-user': 'bob', 'remote-email': 'b@x.pt' },
  });
  expect(a.statusCode).toBe(200);
  expect(b.statusCode).toBe(200);
  const ua = a.json();
  const ub = b.json();
  expect(ua.id).not.toBe(ub.id);
  expect(ua.isAdmin).toBe(true); // first-ever user bootstraps admin
  expect(ub.isAdmin).toBe(false);
  // same identity resolves to the same row (no duplicate provisioning)
  const a2 = await app.inject({ url: '/api/me', headers: { 'remote-user': 'alice' } });
  expect(a2.json().id).toBe(ua.id);
});
