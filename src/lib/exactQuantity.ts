/** Complete decimal inputs only. Extracting the first number cannot establish a quantity. */
export interface ExactQuantity {
  value: string | null;
  issue: 'missing' | 'invalid' | 'ambiguous' | null;
}

function canonical(raw: string): string {
  const [whole, fraction = ''] = raw.split('.');
  const integer = whole.replace(/^0+(?=\d)/, '') || '0';
  const decimal = fraction.replace(/0+$/, '');
  return decimal ? `${integer}.${decimal}` : integer;
}

export function parseExactQuantity(raw: unknown): ExactQuantity {
  if (raw === undefined || raw === null || raw === '') return { value: null, issue: 'missing' };
  if (typeof raw !== 'string') return { value: null, issue: 'invalid' };
  let normalized = raw.trim()
    .replace(/[\u0660-\u0669]/g, char => String(char.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, char => String(char.charCodeAt(0) - 0x06f0));
  if (!normalized) return { value: null, issue: 'missing' };
  if (normalized.length > 64) return { value: null, issue: 'invalid' };

  if (normalized.includes('\u066c')) {
    if (!/^\d{1,3}(?:\u066c\d{3})+(?:\u066b\d+)?$/.test(normalized)) return { value: null, issue: 'invalid' };
    normalized = normalized.replace(/\u066c/g, '');
  }
  normalized = normalized.replace(/\u066b/g, '.');
  if (normalized.includes(',')) {
    if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(normalized)) normalized = normalized.replace(/,/g, '');
    else if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(normalized)) normalized = normalized.replace(/\./g, '').replace(',', '.');
    else if (/^0+,\d+$/.test(normalized)) normalized = normalized.replace(',', '.');
    else if (/^\d+,\d{3}$/.test(normalized) || /^\d{1,3}(?:,\d{3})+$/.test(normalized)) return { value: null, issue: 'ambiguous' };
    else if (/^\d+,\d+$/.test(normalized)) normalized = normalized.replace(',', '.');
    else return { value: null, issue: 'invalid' };
  }
  if (!/^(?:\d+|\d*\.\d+)$/.test(normalized)) return { value: null, issue: 'invalid' };
  const [whole, fraction = ''] = normalized.split('.');
  if (whole.length + fraction.length > 30 || fraction.length > 12) return { value: null, issue: 'invalid' };
  return { value: canonical(normalized), issue: null };
}

/** Exact legacy suffixes are understood; expressions/ranges/prose are never guessed. */
export function parseWorkerCount(raw: unknown): ExactQuantity {
  const input = typeof raw === 'string'
    ? raw.trim().replace(/\s+(?:עובדים|עובד|workers?|عمال|عمّال|عامل|عاملين)$/iu, '')
    : raw;
  const parsed = parseExactQuantity(input);
  return parsed.value?.includes('.') ? { value: null, issue: 'invalid' } : parsed;
}

function parts(value: string): { integer: bigint; scale: number } {
  const [whole, fraction = ''] = value.split('.');
  return { integer: BigInt(whole + fraction), scale: fraction.length };
}

function decimal(integer: bigint, scale: number): string {
  const digits = integer.toString().padStart(scale + 1, '0');
  return canonical(scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits);
}

/** No per-row rounding and no binary floating-point accumulation. */
export function addExact(values: Iterable<string>): string {
  let total = 0n;
  let scale = 0;
  for (const value of values) {
    const next = parts(value);
    const target = Math.max(scale, next.scale);
    total = total * (10n ** BigInt(target - scale)) + next.integer * (10n ** BigInt(target - next.scale));
    scale = target;
  }
  return decimal(total, scale);
}

/** Unit conversion by powers of ten; e.g. tonnes to kilograms is +3. */
export function scaleExact(value: string, power: number): string {
  const parsed = parts(value);
  const scale = parsed.scale - power;
  return scale >= 0 ? decimal(parsed.integer, scale) : decimal(parsed.integer * (10n ** BigInt(-scale)), 0);
}

/** Excel has 15 significant digits. Preserve larger precise values as text. */
export function exactToNumber(value: string): number | null {
  const significant = value.replace('.', '').replace(/^0+/, '').replace(/0+$/, '');
  const number = Number(value);
  if (significant.length > 15 || !Number.isFinite(number)) return null;
  if (!value.includes('.') && !Number.isSafeInteger(number)) return null;
  return number;
}
