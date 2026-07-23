import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { HealthResponse } from '@wallet/shared';
import { env } from './env.js';
import { closeDb, getDb } from './db.js';
import { authHook } from './auth.js';
import { registerRoutes } from './routes.js';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = env.webDir ? resolve(env.webDir) : resolve(here, '../../web/dist');

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: !process.env.VITEST });
  getDb(); // open + migrate on boot
  app.addHook('onClose', async () => closeDb());
  if (env.devUser && env.trustedProxies.length > 0) {
    app.log.warn('AUTH_DEV_USER is set but ignored because TRUSTED_PROXIES is configured.');
  }

  // Public endpoint.
  app.get('/api/health', async (): Promise<HealthResponse> => ({ status: 'ok', version: env.version }));

  // Authenticated API. The auth hook is scoped to this encapsulated context, so it
  // applies to exactly these routes by registration — not a URL-string prefix check
  // (which encoded separators like %2F could slip past). New API routes go here.
  await app.register(async (api) => {
    api.addHook('onRequest', authHook);
    registerRoutes(api);
  });

  // Serve the built PWA + SPA fallback.
  if (existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn(`web build not found at ${webDir} (run: npm run build -w web)`);
  }

  return app;
}

// Only listen when run directly (not when imported by tests).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await buildApp();
  app.listen({ port: env.port, host: env.host }).catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
}
