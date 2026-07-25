// Generic CSV statement import: any bank, via a column mapping the user confirms.
// Pure (no DOM) so the browser and vitest share it. Complements the per-bank PDF parsers
// in parsers.ts — this is the fallback for banks with no dedicated parser.

import type { ParsedRow } from './types.js';
import { parseAmountCell } from './money.js';

/** RFC4180-ish parse: quoted fields, doubled quotes, CRLF, auto delimiter (`,` `;` or tab). */
export function parseCsv(text: string): string[][] {
  const delimiter = pickDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ''));
}

/**
 * Most frequent delimiter wins — PT exports usually use `;`. Only counts separators *outside*
 * quotes: a semicolon-delimited file with comma-rich merchant names would otherwise look
 * comma-delimited and every row would fail to parse.
 */
function pickDelimiter(text: string): string {
  const sample = text.split('\n').slice(0, 20);
  const countOutsideQuotes = (line: string, delimiter: string) => {
    let quoted = false;
    let count = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        if (quoted && line[i + 1] === '"') i++; // escaped quote
        else quoted = !quoted;
      } else if (!quoted && line[i] === delimiter) count++;
    }
    return count;
  };
  const score = (d: string) => sample.reduce((n, line) => n + countOutsideQuotes(line, d), 0);
  return [';', ',', '\t'].sort((a, b) => score(b) - score(a))[0];
}

export interface CsvMapping {
  date: number;
  amount: number;
  description: number;
  /** Running-balance column ("Saldo contabilístico"). -1/absent = none. Enables reconcile. */
  balance?: number;
  /** Some exports list expenses as positive; flip every sign. */
  invertSign?: boolean;
  /** Rows before the header/data start (auto-detected, user can override). */
  skipRows?: number;
}

const DATE_HINTS = /^(data|date|data\s*mov|data\s*valor|movement|fecha)/i;
const AMOUNT_HINTS = /^(valor|montante|amount|import|d[ée]bito|cr[ée]dito|value)/i;
const DESC_HINTS = /^(descri|desc|hist[oó]rico|movimento|concept|detail|refer)/i;
const BALANCE_HINTS = /^(saldo|balance)/i;

/** Best-guess column mapping from a header row; -1 when a column can't be identified. */
export function guessMapping(header: string[]): CsvMapping {
  const find = (re: RegExp) => header.findIndex((h) => re.test(h.trim()));
  return { date: find(DATE_HINTS), amount: find(AMOUNT_HINTS), description: find(DESC_HINTS), balance: find(BALANCE_HINTS) };
}

interface BalRow {
  amount: number;
  balance: number;
}
/** Rows (in file order) where both the amount and balance cells parse — the reconcile candidates. */
function balanceRows(table: string[][], mapping: CsvMapping): BalRow[] {
  if (mapping.balance == null || mapping.balance < 0) return [];
  const out: BalRow[] = [];
  for (const r of table.slice(mapping.skipRows ?? 1)) {
    const amount = parseAmountCell(r[mapping.amount] ?? '');
    const balance = parseAmountCell(r[mapping.balance] ?? '');
    if (amount === null || amount === 0 || balance === null) continue;
    out.push({ amount, balance });
  }
  return out;
}

/** The account's current book balance = the newest row's running balance (CGD exports newest-first). */
export function statementEndBalanceCents(table: string[][], mapping: CsvMapping): number | null {
  const rows = balanceRows(table, mapping);
  return rows.length ? rows[0].balance : null;
}

/**
 * True when EVERY adjacent running-balance transition chains (newest-first): each row's
 * balance minus its amount equals the immediately-older row's balance, within a cent. Checking
 * only the endpoints would let a mis-mapped middle row slip through, so validate every step.
 * Guards a mis-mapped or re-ordered (oldest-first) file from silently reconciling.
 */
export function balanceIsConsistent(table: string[][], mapping: CsvMapping): boolean {
  const rows = balanceRows(table, mapping);
  if (rows.length < 2) return false;
  return rows.slice(0, -1).every((newer, i) => Math.abs(newer.balance - newer.amount - rows[i + 1].balance) <= 1);
}

/** "2026-06-01" / "01-06-2026" / "01/06/26" → ISO, or null. Calendar-validated. */
export function toIsoDate(cell: string): string | null {
  const t = cell.trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  let y: number, mo: number, d: number;
  if (m) [, y, mo, d] = m.map(Number) as unknown as [unknown, number, number, number];
  else {
    m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
  }
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(dt.valueOf()) && dt.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Apply a mapping to CSV rows → ledger rows. Unparseable rows are skipped, not guessed. */
export function rowsFromCsv(table: string[][], mapping: CsvMapping): ParsedRow[] {
  const body = table.slice(mapping.skipRows ?? 1); // default: drop the header row
  const out: ParsedRow[] = [];
  for (const r of body) {
    const date = toIsoDate(r[mapping.date] ?? '');
    const amount = parseAmountCell(r[mapping.amount] ?? '');
    if (date === null || amount === null || amount === 0) continue;
    out.push({
      date,
      amountCents: mapping.invertSign ? -amount : amount,
      description: (r[mapping.description] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      externalRef: null, // synthesized server-side for dedup
    });
  }
  return out;
}
