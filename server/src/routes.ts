import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { BackupData } from '@wallet/shared';
import { ZodError } from 'zod';
import { getDb } from './db.js';
import { HttpError } from './errors.js';
import * as svc from './service.js';
import * as car from './car.js';
import * as rec from './recurring.js';
import * as bank from './bank.js';
import * as receipts from './receipts.js';
import * as stats from './stats.js';
import * as backup from './backup.js';
import * as debt from './debt.js';
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

  // ---- category rules (auto-categorize imports) ----
  app.get('/api/category-rules', async (req) => svc.listCategoryRules(getDb(), uid(req)));
  app.post('/api/category-rules', async (req, reply) => {
    const r = svc.createCategoryRule(getDb(), uid(req), S.categoryRuleCreate.parse(req.body));
    return reply.code(201).send(r);
  });
  app.delete('/api/category-rules/:id', async (req, reply) => {
    svc.deleteCategoryRule(getDb(), uid(req), paramId(req));
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

  // ---- vehicles ----
  app.get('/api/vehicles', async (req) => car.listVehicles(getDb(), uid(req)));
  app.post('/api/vehicles', async (req, reply) => {
    const v = car.createVehicle(getDb(), uid(req), S.vehicleCreate.parse(req.body));
    return reply.code(201).send(v);
  });
  app.patch('/api/vehicles/:id', async (req) =>
    car.updateVehicle(getDb(), uid(req), paramId(req), S.vehicleUpdate.parse(req.body)),
  );
  app.delete('/api/vehicles/:id', async (req, reply) => {
    car.deleteVehicle(getDb(), uid(req), paramId(req));
    return reply.code(204).send();
  });
  app.get('/api/vehicles/:id/stats', async (req) => car.getCarStats(getDb(), uid(req), paramId(req)));

  // ---- fuel entries ----
  app.get('/api/fuel', async (req) => {
    const { vehicleId } = S.fuelListQuery.parse(req.query);
    return car.listFuelEntries(getDb(), uid(req), vehicleId);
  });
  app.post('/api/fuel', async (req, reply) => {
    const f = car.createFuelEntry(getDb(), uid(req), S.fuelCreate.parse(req.body));
    return reply.code(201).send(f);
  });
  app.patch('/api/fuel/:id', async (req) =>
    car.updateFuelEntry(getDb(), uid(req), paramId(req), S.fuelUpdate.parse(req.body)),
  );
  app.delete('/api/fuel/:id', async (req, reply) => {
    car.deleteFuelEntry(getDb(), uid(req), paramId(req));
    return reply.code(204).send();
  });

  // ---- recurring rules ----
  app.get('/api/recurring', async (req) => rec.listRules(getDb(), uid(req)));
  app.post('/api/recurring', async (req, reply) => {
    const r = rec.createRule(getDb(), uid(req), S.recurringCreate.parse(req.body));
    return reply.code(201).send(r);
  });
  app.patch('/api/recurring/:id', async (req) =>
    rec.updateRule(getDb(), uid(req), paramId(req), S.recurringUpdate.parse(req.body)),
  );
  app.delete('/api/recurring/:id', async (req, reply) => {
    rec.deleteRule(getDb(), uid(req), paramId(req));
    return reply.code(204).send();
  });
  app.post('/api/recurring/run', async (req) => rec.runAutoPost(getDb(), uid(req)));
  app.get('/api/recurring/upcoming', async (req) => {
    const { days } = S.upcomingQuery.parse(req.query);
    return rec.upcoming(getDb(), uid(req), days);
  });
  app.get('/api/recurring/suggestions', async (req) => rec.suggestions(getDb(), uid(req)));

  // ---- forecast ----
  app.get('/api/forecast', async (req) => {
    const { months } = S.forecastQuery.parse(req.query);
    return rec.forecast(getDb(), uid(req), months);
  });

  // ---- bank import ----
  app.post('/api/import/preview', async (req) => {
    const { accountId, rows } = S.importPreview.parse(req.body);
    return bank.previewImport(getDb(), uid(req), accountId, rows);
  });
  app.post('/api/import/commit', async (req, reply) => {
    const body = S.importCommit.parse(req.body);
    return reply.code(201).send(bank.commitImport(getDb(), uid(req), body));
  });
  app.get('/api/import', async (req) => bank.listImports(getDb(), uid(req)));
  app.delete('/api/import/:id', async (req, reply) => {
    bank.revertImport(getDb(), uid(req), paramId(req));
    return reply.code(204).send();
  });

  // ---- receipts (Phase 5) ----
  app.post('/api/receipts', async (req, reply) => {
    const tx = receipts.createReceipt(getDb(), uid(req), S.receiptCreate.parse(req.body));
    return reply.code(201).send(tx);
  });
  // :id is the transaction id — the client has it from create and from the tx list.
  app.get('/api/receipts/by-tx/:id/image', async (req, reply) => {
    const img = receipts.getReceiptImageByTx(getDb(), uid(req), paramId(req));
    if (!img) throw new HttpError(404, 'receipt not found');
    return reply.type(img.mime).send(img.data);
  });

  // ---- stats & portability (Phase 6) ----
  app.get('/api/stats', async (req) => {
    const { months } = S.statsQuery.parse(req.query);
    const thisMonth = new Date().toISOString().slice(0, 7);
    return stats.getStats(getDb(), uid(req), thisMonth, req.user!.fyStartMonth, months);
  });
  app.get('/api/debt', async (req) => debt.getDebts(getDb(), uid(req)));
  app.get('/api/export', async (req, reply) => {
    reply.header('content-disposition', 'attachment; filename="wallet-backup.json"');
    return backup.exportBackup(getDb(), uid(req));
  });
  app.get('/api/export.csv', async (req, reply) => {
    reply.header('content-disposition', 'attachment; filename="wallet-transactions.csv"');
    return reply.type('text/csv').send(backup.exportCsv(getDb(), uid(req)));
  });
  app.post('/api/import/backup', async (req, reply) =>
    reply.code(201).send(backup.importBackup(getDb(), uid(req), S.backupImport.parse(req.body) as BackupData)),
  );
}
