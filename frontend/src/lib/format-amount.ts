/** Display decimal text without converting token values through floating point. */
export function formatAmount(value: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const [integer, fraction] = value.split('.');
  const grouped = BigInt(integer).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}
