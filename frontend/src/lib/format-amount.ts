/** Display decimal text without converting token values through floating point. */
export function formatAmount(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) return null;
  const [integer, fraction] = value.split('.');
  const grouped = BigInt(integer).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export const JPYC_DECIMALS = 18;

/**
 * Convert an on-chain JPYC amount (integer base units, 18 decimals) into the decimal text `formatAmount`
 * and the `Amount` atom expect, e.g. 20000000000000000000000n -> "20000". Integer math only; trailing
 * zero decimals are dropped. Returns null for anything that is not a non-negative integer.
 */
export function jpycFromBaseUnits(value: unknown, decimals = JPYC_DECIMALS): string | null {
  let raw: bigint;
  if (typeof value === 'bigint') raw = value;
  else if (typeof value === 'string' && /^\d+$/.test(value)) raw = BigInt(value);
  else return null;
  if (raw < 0n) return null;
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
