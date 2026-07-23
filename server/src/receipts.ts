import type { DatabaseSync } from 'node:sqlite';
import type { Transaction } from '@wallet/shared';
import { HttpError } from './errors.js';
import { createTransaction } from './service.js';

export interface ReceiptInput {
  date: string;
  amountCents: number;
  accountId: number;
  categoryId: number | null;
  description: string;
  imageBase64: string;
  mime: string;
  ocrText: string | null;
  parsedJson: string | null;
}

/** Create the confirmed transaction and its linked receipt image atomically. */
export function createReceipt(db: DatabaseSync, userId: number, input: ReceiptInput): Transaction {
  const image = Buffer.from(input.imageBase64, 'base64');
  if (image.length === 0) throw new HttpError(400, 'empty image');

  db.exec('BEGIN');
  try {
    // createTransaction asserts account/category ownership and inserts (no own txn).
    const tx = createTransaction(db, userId, {
      date: input.date,
      amountCents: input.amountCents,
      accountId: input.accountId,
      categoryId: input.categoryId,
      description: input.description,
      note: null, // the receipt UI captures no note; keep the column but leave it empty
      source: 'receipt',
    });
    db.prepare(
      'INSERT INTO receipts(user_id,transaction_id,image,mime,ocr_text,parsed_json) VALUES(?,?,?,?,?,?)',
    ).run(userId, tx.id, image, input.mime, input.ocrText, input.parsedJson);
    db.exec('COMMIT');
    return tx;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** The stored receipt image for one of the user's transactions, or null. Keyed by
 *  transaction id (which the client always has) so the image is reachable after create. */
export function getReceiptImageByTx(db: DatabaseSync, userId: number, txId: number): { mime: string; data: Buffer } | null {
  const row = db.prepare('SELECT mime, image FROM receipts WHERE transaction_id=? AND user_id=?').get(txId, userId) as
    | { mime: string; image: Uint8Array }
    | undefined;
  return row ? { mime: row.mime, data: Buffer.from(row.image) } : null;
}
