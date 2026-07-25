import { describe, expect, it } from 'vitest';
import { balanceIsConsistent, guessMapping, parseCsv, rowsFromCsv, statementEndBalanceCents, toIsoDate } from './csv.js';
import { parseAmountCell } from './money.js';

describe('parseCsv', () => {
  it('handles quoted fields, doubled quotes and semicolon delimiters', () => {
    const t = 'Data;Descrição;Valor\n2026-06-01;"LIDL, ALMADA";-25,50\n2026-06-02;"He said ""hi""";10,00\n';
    expect(parseCsv(t)).toEqual([
      ['Data', 'Descrição', 'Valor'],
      ['2026-06-01', 'LIDL, ALMADA', '-25,50'],
      ['2026-06-02', 'He said "hi"', '10,00'],
    ]);
  });

  it('ignores delimiters inside quotes when sniffing (commas in a ;-delimited file)', () => {
    const t = [
      'Data;Descricao;Valor',
      '2026-06-01;"LIDL, ALMADA, PT";-25,50',
      '2026-06-02;"A, B, C, D";-1,00',
      '',
    ].join('\n');
    // Naive counting would see more commas than semicolons and split every row wrongly.
    expect(parseCsv(t)[1]).toEqual(['2026-06-01', 'LIDL, ALMADA, PT', '-25,50']);
  });

  it('auto-detects a comma delimiter and skips blank lines', () => {
    expect(parseCsv('a,b\n1,2\n\n3,4\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });
});

describe('parseAmountCell', () => {
  it('reads PT and EN formats, signs and parentheses', () => {
    expect(parseAmountCell('-25,50')).toBe(-2550);
    expect(parseAmountCell('1.234,56')).toBe(123456);
    expect(parseAmountCell('1,234.56')).toBe(123456);
    expect(parseAmountCell('(12,00)')).toBe(-1200);
    expect(parseAmountCell('25,50-')).toBe(-2550);
    expect(parseAmountCell('1500')).toBe(150000); // whole units, no decimals
    expect(parseAmountCell('')).toBeNull();
    expect(parseAmountCell('n/a')).toBeNull();
    expect(parseAmountCell('1,234.567,89')).toBeNull(); // mixed grouping → reject, don't coerce
  });
});

describe('toIsoDate', () => {
  it('accepts ISO and day-first formats, rejects impossible dates', () => {
    expect(toIsoDate('2026-06-01')).toBe('2026-06-01');
    expect(toIsoDate('01-06-2026')).toBe('2026-06-01');
    expect(toIsoDate('01/06/26')).toBe('2026-06-01');
    expect(toIsoDate('31-02-2026')).toBeNull(); // no such day
    expect(toIsoDate('nope')).toBeNull();
  });
});

describe('guessMapping + rowsFromCsv', () => {
  const csv = [
    'Data mov;Descrição;Valor',
    '2026-06-01;LIDL;-25,50',
    '2026-06-02;SALARIO;1.500,00',
    'saldo final;;', // junk row → skipped, not guessed at
  ].join('\n');

  it('finds the columns from the header and converts rows', () => {
    const table = parseCsv(csv);
    const mapping = guessMapping(table[0]);
    expect(mapping).toMatchObject({ date: 0, description: 1, amount: 2 });

    const rows = rowsFromCsv(table, mapping);
    expect(rows).toEqual([
      { date: '2026-06-01', amountCents: -2550, description: 'LIDL', externalRef: null },
      { date: '2026-06-02', amountCents: 150000, description: 'SALARIO', externalRef: null },
    ]);
  });

  it('invertSign flips exports that list expenses as positive', () => {
    const table = parseCsv(csv);
    const rows = rowsFromCsv(table, { ...guessMapping(table[0]), invertSign: true });
    expect(rows.map((r) => r.amountCents)).toEqual([2550, -150000]);
  });

  it('reports -1 for columns it cannot identify', () => {
    expect(guessMapping(['foo', 'bar'])).toEqual({ date: -1, amount: -1, description: -1, balance: -1 });
  });
});

describe('balance reconcile helpers', () => {
  // CGD-style: newest-first, running balance in "Saldo". Opening 60,00 → chains to 85,96 latest:
  // 60,00 −30,04(PINGO)=29,96, −25,50(LIDL)=4,46, +81,50(SALARIO)=85,96.
  const consistent = [
    'Data mov;Descrição;Valor;Saldo',
    '2026-06-20;SALARIO;81,50;85,96', // newest → latest balance
    '2026-06-10;LIDL;-25,50;4,46',
    '2026-06-01;PINGO;-30,04;29,96', // oldest
  ].join('\n');

  it('detects the balance column from the header', () => {
    expect(guessMapping(parseCsv(consistent)[0])).toMatchObject({ date: 0, amount: 2, balance: 3 });
  });

  it('reads the latest (newest-first, top row) balance', () => {
    const table = parseCsv(consistent);
    expect(statementEndBalanceCents(table, guessMapping(table[0]))).toBe(8596);
  });

  it('accepts a running balance that reconciles', () => {
    const table = parseCsv(consistent);
    expect(balanceIsConsistent(table, guessMapping(table[0]))).toBe(true);
  });

  it('rejects a mis-mapped / inconsistent balance column', () => {
    // Correct endpoints + amounts, but the MIDDLE Saldo is corrupted → an endpoint-only check
    // would wrongly pass; the per-transition check must catch the broken interior row.
    const bad = [
      'Data mov;Descrição;Valor;Saldo',
      '2026-06-20;SALARIO;81,50;85,96',
      '2026-06-10;LIDL;-25,50;999,99',
      '2026-06-01;PINGO;-30,04;29,96',
    ].join('\n');
    const table = parseCsv(bad);
    expect(balanceIsConsistent(table, guessMapping(table[0]))).toBe(false);
  });

  it('returns null / false when there is no balance column', () => {
    const table = parseCsv('Data mov;Descrição;Valor\n2026-06-01;LIDL;-25,50');
    const m = guessMapping(table[0]);
    expect(statementEndBalanceCents(table, m)).toBeNull();
    expect(balanceIsConsistent(table, m)).toBe(false);
  });
});
