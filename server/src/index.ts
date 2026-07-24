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
  // bodyLimit lifts the 1 MB default so a base64 receipt photo fits (client downscales first).
  const app = Fastify({ logger: !process.env.VITEST, bodyLimit: 16 * 1024 * 1024 });
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

  // Lock the page to its own origin. OCR/PDF assets are vendored and served from here, so no
  // CDN is needed; wasm-unsafe-eval is required to instantiate the Tesseract/pdf.js wasm, and
  // blob: covers their workers plus the receipt preview object URLs.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'", // Tailwind injects a style element
    "img-src 'self' data: blob:",
    "connect-src 'self' blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  app.addHook('onSend', async (_req, reply) => {
    reply.header('content-security-policy', csp);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
  });

  // Serve the built PWA + SPA fallback.
  if (existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      // Only real navigations get the SPA shell. Without this a missing asset (a mistyped OCR
      // model path, say) answers 200 text/html, and the consumer fails on garbage instead of 404.
      const accepts = req.headers.accept ?? '';
      if (!accepts.includes('text/html')) return reply.code(404).send({ error: 'not_found' });
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
