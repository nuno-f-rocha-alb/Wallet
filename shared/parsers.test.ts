import { expect, test } from 'vitest';
import { detectBank, parseStatement, ptToCents } from './parsers.js';

test('ptToCents parses Portuguese money', () => {
  expect(ptToCents('1.637,40')).toBe(163740);
  expect(ptToCents('-11,45')).toBe(-1145);
  expect(ptToCents('12.345,67')).toBe(1234567);
  expect(ptToCents('0,00')).toBe(0);
});

// Synthetic statement in CGD's layout — NOT real account data. Derived from the
// public structure of a "Extrato Global": header with NIB + SWIFT, "Saldo anterior",
// then rows of "<date> <description> [ref] <amount> <running balance>".
const CGD_FIXTURE = [
  'Extrato n.º 007/2026 Emissão 2026-07-03 Período 2026-06-01 a 2026-06-30 Pág 1/6',
  'NIB 003500001234567890123 SWIFT/BIC CGDIPTPL',
  'Saldo anterior 1.000,00',
  'Data Valor Descrição Valor Saldo Contabilístico',
  '- - 2026-06-01 COMPRAS C.DEB SUPERMERCADO 1770000001 -25,50 974,50',
  '- - 2026-06-02 VIA VERDE -3,00 971,50',
  '- - 2026-06-03 TFI SALARIO ACME 1.500,00 2.471,50',
  '- - 2026-06-03 COMPRAS C.DEB SUPERMERCADO 1770000002 -12,00 2.459,50',
  'caixadirecta - 217 900 790 (chamada para a rede fixa nacional)',
].join('\n');

test('parses a CGD statement: bank, account ref, opening balance, rows', () => {
  const st = parseStatement(CGD_FIXTURE)!;
  expect(st.bankId).toBe('cgd');
  expect(st.accountRef).toBe('003500001234567890123');
  expect(st.openingBalanceCents).toBe(100000);
  expect(st.rows).toHaveLength(4); // header/footer/opening lines ignored

  expect(st.rows[0]).toEqual({
    date: '2026-06-01',
    amountCents: -2550,
    description: 'COMPRAS C.DEB SUPERMERCADO',
    externalRef: 'cgd:1770000001', // trailing ref pulled out for exact dedup
  });
  expect(st.rows[1]).toEqual({ date: '2026-06-02', amountCents: -300, description: 'VIA VERDE', externalRef: null });
  expect(st.rows[2]).toMatchObject({ amountCents: 150000, description: 'TFI SALARIO ACME' }); // thousands + credit

  // both supermarket rows share the merchant text (refs stripped) so memory can group them
  expect(st.rows[3].description).toBe(st.rows[0].description);
  expect(st.rows[3].externalRef).not.toBe(st.rows[0].externalRef);
});

test('detectBank returns null for an unknown bank', () => {
  expect(detectBank('Some other bank statement, IBAN PT50...')).toBeNull();
  expect(parseStatement('nothing recognizable here')).toBeNull();
});
