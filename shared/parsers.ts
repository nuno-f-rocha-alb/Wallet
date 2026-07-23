// Bank-statement parsers. Pure text → rows (no DOM, no pdf.js), so both the browser
// (after pdf.js extracts the text) and vitest import this. Each bank is a small module
// in BANKS; add a bank by adding an entry, not by touching the import flow.

import type { ParsedRow } from './types.js';

export interface ParsedStatement {
  bankId: string;
  bankName: string;
  accountRef: string | null; // NIB/IBAN from the statement — to confirm the target account
  openingBalanceCents: number | null;
  rows: ParsedRow[];
}

export interface BankParser {
  id: string;
  name: string;
  /** Cheap signature check on the raw statement text. */
  detect: (text: string) => boolean;
  parse: (text: string) => ParsedStatement;
}

/** Portuguese money "1.637,40" / "-11,45" → integer cents. */
export function ptToCents(s: string): number {
  return Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100);
}

// PT money with thousands dots + comma decimals, e.g. "1.637,40", "-11,45". The
// lookarounds stop it matching inside a longer number (CGD always uses the dot).
const MONEY = /(?<![\d.,])-?\d{1,3}(?:\.\d{3})*,\d{2}(?![\d.,])/g;

// ---- Caixa Geral de Depósitos ----

const cgd: BankParser = {
  id: 'cgd',
  name: 'Caixa Geral de Depósitos',
  detect: (t) => /CGDIPTPL/.test(t) || /Caixa Geral de Dep[óo]sitos/i.test(t),
  parse: (text) => {
    // NIB (contiguous digits) or IBAN (optionally "PT50 …" with spaces) → normalized digits.
    const refMatch = text.match(/\b(?:NIB|IBAN)\s+((?:PT\d{2}\s?)?[\d\s]{9,30})/i);
    const accountRef = refMatch ? refMatch[1].replace(/\s/g, '') : null;
    const opening = text.match(/Saldo anterior\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})/i);
    const rows: ParsedRow[] = [];
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\s+/g, ' ').trim();
      const dateM = line.match(/\d{4}-\d{2}-\d{2}/);
      if (!dateM) continue;
      const moneys = [...line.matchAll(MONEY)];
      if (moneys.length < 2) continue; // need amount + running balance
      const amount = moneys[moneys.length - 2]; // last two are amount, balance
      const amountCents = ptToCents(amount[0]);
      if (amountCents === 0) continue;
      let desc = line.slice(dateM.index! + 10, amount.index!).trim();
      // CGD appends a numeric transaction reference — pull it out for exact dedup,
      // and strip it so the merchant text groups across visits.
      let externalRef: string | null = null;
      const refM = desc.match(/(?:^|\s)(\d{6,})$/);
      if (refM) {
        externalRef = `cgd:${refM[1]}`;
        desc = desc.slice(0, refM.index).trim();
      }
      desc = desc.replace(/\s+/g, ' ').trim();
      if (!desc) continue;
      rows.push({ date: dateM[0], amountCents, description: desc, externalRef });
    }
    return {
      bankId: cgd.id,
      bankName: cgd.name,
      accountRef,
      openingBalanceCents: opening ? ptToCents(opening[1]) : null,
      rows,
    };
  },
};

export const BANKS: BankParser[] = [cgd];

/** Pick the parser whose signature matches the statement text, if any. */
export function detectBank(text: string): BankParser | null {
  return BANKS.find((b) => b.detect(text)) ?? null;
}

/** Detect the bank and parse, or null if no known bank matches. */
export function parseStatement(text: string): ParsedStatement | null {
  return detectBank(text)?.parse(text) ?? null;
}
