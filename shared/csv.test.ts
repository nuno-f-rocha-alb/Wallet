import { describe, expect, it } from 'vitest';
import { guessMapping, parseCsv, rowsFromCsv, toIsoDate } from './csv.js';
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
    expect(guessMapping(['foo', 'bar'])).toEqual({ date: -1, amount: -1, description: -1 });
  });
});
