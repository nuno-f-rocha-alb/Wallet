import { parseMoney } from './money.js';

// Receipt OCR-text → {total, date, merchant} heuristics. Pure (no DOM, no Tesseract),
// so the browser (after OCR produces text) and vitest both import this. QR path dropped
// (spec 2026-07-23): the PT AT QR carries no line items, only totals OCR already reads.

export { parseMoney };

export interface ReceiptParse {
  totalCents: number | null; // IVA-inclusive grand total (what was paid)
  date: string | null; // YYYY-MM-DD, or null → caller falls back to today
  merchant: string | null; // shop name for the description, or null → blank
}


// Every money-looking token on a line; each is validated by parseMoney.
const MONEY_TOKEN = /\d[\d.,]*[.,]\d{2}/g;
// A "total" line, but not a subtotal / VAT-amount / net (sem IVA) line — we want the
// grand total incl. tax. Among matching lines we take the largest value as the total.
const IS_TOTAL = /total|a\s*pagar|montante/i;
// Exclude subtotals, the VAT-amount line, the net (sem IVA) line, and the cash-handling
// lines — tendered ("entregue/recebido") and change ("troco") often exceed the payable total.
const NOT_TOTAL = /sub-?total|sem\s*iva|s\/\s*iva|total\s*(?:de\s*)?iva|iliquido|il[ií]quido|troco|entregue|recebido/i;

function findTotalCents(lines: string[]): number | null {
  let best: number | null = null;
  for (const line of lines) {
    if (!IS_TOTAL.test(line) || NOT_TOTAL.test(line)) continue;
    for (const tok of line.match(MONEY_TOKEN) ?? []) {
      const c = parseMoney(tok);
      if (c !== null && (best === null || c > best)) best = c;
    }
  }
  return best;
}

/** Normalize a matched Y/M/D triple to a valid ISO date, or null. */
function toIso(y: number, mo: number, d: number): string | null {
  if (y < 100) y += 2000;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(dt.valueOf()) && dt.toISOString().slice(0, 10) === iso ? iso : null;
}

function findDate(text: string): string | null {
  let m = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); // ISO-ish Y M D
  if (m) return toIso(+m[1], +m[2], +m[3]);
  m = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); // D M Y (PT default)
  if (m) return toIso(+m[3], +m[2], +m[1]);
  return null;
}

// A plausible merchant line: has letters, isn't a date/total/fiscal line or pure noise.
const NOISE = /^(nif|contribuinte|fatura|factura|recibo|data|hora|iva|total|obrigad)/i;
function findMerchant(lines: string[]): string | null {
  for (const line of lines) {
    const t = line.trim();
    if (t.length < 3 || NOISE.test(t)) continue;
    if ((t.match(/[a-zà-ÿ]/gi) ?? []).length < 2) continue; // needs real letters
    if (/^\d[\d.,\s/:-]*$/.test(t)) continue; // all-numeric (date/amount)
    return t.slice(0, 100);
  }
  return null;
}

export function parseReceipt(text: string): ReceiptParse {
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return {
    totalCents: findTotalCents(lines),
    date: findDate(text),
    merchant: findMerchant(lines),
  };
}
