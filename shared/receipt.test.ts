import { describe, expect, it } from 'vitest';
import { parseMoney, parseReceipt } from './receipt.js';

describe('parseMoney', () => {
  it('handles PT and EN thousands/decimal separators', () => {
    expect(parseMoney('12,34')).toBe(1234);
    expect(parseMoney('12.34')).toBe(1234);
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('1,234.56')).toBe(123456);
    expect(parseMoney('€ 2,57')).toBe(257);
  });
  it('rejects non-money / no-decimal tokens', () => {
    expect(parseMoney('1234')).toBeNull(); // receipts always show cents
    expect(parseMoney('abc')).toBeNull();
  });
});

describe('parseReceipt', () => {
  // DoD: total (IVA-inclusive grand total, not the subtotal), date (DD-MM-YYYY → ISO),
  // merchant (top line, not the NIF/date noise).
  const receipt = [
    'CONTINENTE',
    'Rua Example 123, Lisboa',
    'NIF: 500829993',
    'Fatura Simplificada',
    'Data: 23-07-2026',
    'Arroz          1,20',
    'Leite          0,89',
    'IVA 23%        0,48',
    'Subtotal       2,09',
    'TOTAL A PAGAR  2,57',
    'Troco          7,43',
  ].join('\n');

  it('picks the IVA-inclusive grand total, not subtotal/IVA/troco', () => {
    expect(parseReceipt(receipt).totalCents).toBe(257);
  });
  it('parses the date to YYYY-MM-DD', () => {
    expect(parseReceipt(receipt).date).toBe('2026-07-23');
  });
  it('takes the merchant from the top, skipping fiscal noise', () => {
    expect(parseReceipt(receipt).merchant).toBe('CONTINENTE');
  });
  it('does not mistake the tendered cash for the payable total', () => {
    expect(parseReceipt(`${receipt}\nMontante entregue 10,00`).totalCents).toBe(257);
  });

  it('returns nulls (graceful fallback) when nothing is readable', () => {
    expect(parseReceipt('%%% ??? \n 8888 ')).toEqual({ totalCents: null, date: null, merchant: null });
  });
});
