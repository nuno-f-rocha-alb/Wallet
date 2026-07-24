// Money parsing shared by the receipt OCR heuristics and the CSV statement import.
// Integer cents only — no floats reach the ledger. Grouping must be internally consistent:
// a malformed value is rejected rather than coerced, so a bad CSV row is skipped, not imported
// with a silently wrong amount.

// Either PT style (dot thousands, comma decimals) or EN style (comma thousands, dot decimals).
// Mixed grouping like "1,234.567,89" matches neither and is rejected.
const MONEY_RE = /^(?:(\d+|\d{1,3}(?:\.\d{3})+),(\d{2})|(\d+|\d{1,3}(?:,\d{3})+)\.(\d{2}))$/;
// Whole units with consistent (or absent) thousands grouping: "1500", "1.500", "1,500".
const WHOLE_RE = /^(?:\d+|\d{1,3}(?:\.\d{3})+|\d{1,3}(?:,\d{3})+)$/;

/** A single money token ("1.234,56" / "12,34" / "12.34" / "1,234.56") → integer cents. */
export function parseMoney(raw: string): number | null {
  const m = raw.replace(/[^\d.,]/g, '').match(MONEY_RE);
  if (!m) return null;
  const cents = Number((m[1] ?? m[3]).replace(/[.,]/g, '')) * 100 + Number(m[2] ?? m[4]);
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * A signed money cell from a statement: handles a leading/trailing minus, parentheses for
 * negatives, and whole-unit cells ("1500") that parseMoney deliberately rejects on receipts.
 */
export function parseAmountCell(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const negative = /^-/.test(t) || /-$/.test(t) || /^\(.*\)$/.test(t);
  const bare = t.replace(/[()]/g, '').replace(/^-|-$/g, '').replace(/\s/g, '').trim();
  let cents = parseMoney(bare);
  if (cents === null) {
    if (!WHOLE_RE.test(bare)) return null;
    cents = Number(bare.replace(/[^\d]/g, '')) * 100;
    if (!Number.isSafeInteger(cents)) return null;
  }
  return negative ? -cents : cents;
}
