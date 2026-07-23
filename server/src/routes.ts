import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { getDb } from './db.js';
import { HttpError } from './errors.js';
import * as svc from './service.js';
import * as S from './schemas.js';

function uid(req: FastifyRequest): number {
  if (!req.user) throw new HttpError(401, 'unauthenticated');
  return req.user.id;
}
function paramId(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'invalid id');
  return id;
}

export function registerRoutes(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'validation', issues: err.issues });
    req.log.error(err);
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/api/me', async (req) => req.user);

  // ---- accounts ----
  app.get('/api/accounts', async (req) => svc.listAccounts(getDb(), uid(req)));
  app.post('/api/accounts', async (req, reply) => {
    const a = svc.createAccount(getDb(), uid(req), S.accountCreate.parse(req.body));
    return reply.code(201).send(a);
  });
  app.patch('/api/accounts/:id', async (req) =>
    svc.updateAccount(getDb(), uid(req), paramId(req), S.accountUpdate.parse(req.body)),
  );
  app.delete('/api/accounts/:id', async (req, reply) => {
    svc.deleteAccount(getDb(), uid(req), paramId(req));
    return reply.code(204).send();
  });

  // ---- categories ----
  app.get('/api/categories', async (req) => svc.listCategories(getDb(), uid(req)));
  app.post('/api/categories', async (req, reply) => {
    const c = svc.createCategory(getDb(), uid(req), S.categoryCreate.parse(req.body));
    return reply.code(201).send(c);
  });
  app.patch('/api/categories/:id', async (req) =>
    svc.updateCategory(getDb(), uid(req), paramId(req), S.categoryUpdate.parse(req.body)),
  );
  app.delete('/api/categories/:id', async (req, reply) => {
    svc.deleteCategory(getDb(), uid(req), paramId(req));
    return reply.code(204).send();
  });

  // ---- transactions ----
  app.get('/api/transactions', async (req) =>
    svc.listTransactions(getDb(), uid(req), S.txListQuery.parse(req.query)),
  );
  app.post('/api/transactions', async (req, reply) => {
    const t = svc.createTransaction(getDb(), uid(req), S.transactionCreate.parse(req.body));
    return reply.code(201).send(t);
  });
  app.patch('/api/transactions/:id', async (req) =>
    svc.updateTransaction(getDb(), uid(req), paramId(req), S.transactionUpdate.parse(req.body)),
  );
  app.delete('/api/transactions/:id', async (req, reply) => {
    svc.deleteTransaction(getDb(), uid(req), paramId(req));
    return reply.code(204).send();
  });

  // ---- transfers ----
  app.post('/api/transfers', async (req, reply) => {
    const t = svc.createTransfer(getDb(), uid(req), S.transferCreate.parse(req.body));
    return reply.code(201).send(t);
  });
  app.delete('/api/transfers/:id', async (req, reply) => {
    svc.deleteTransfer(getDb(), uid(req), paramId(req));
    return reply.code(204).send();
  });

  // ---- dashboard ----
  app.get('/api/dashboard', async (req) => {
    const { month } = S.dashboardQuery.parse(req.query);
    return svc.getDashboard(getDb(), uid(req), month);
  });
}
