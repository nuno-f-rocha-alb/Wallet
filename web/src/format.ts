const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

/** Integer cents -> "€1,234.56". */
export const money = (cents: number): string => eur.format(cents / 100);

/** Euro string/number -> integer cents (rounded). */
export const toCents = (euros: number): number => Math.round(euros * 100);

export const todayISO = (): string => new Date().toISOString().slice(0, 10);
export const thisMonth = (): string => new Date().toISOString().slice(0, 7);

/** "2026-07" -> "July 2026". */
export function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-IE', { month: 'long', year: 'numeric' });
}

export function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "2026-07-10" -> "10 Jul". */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
}
