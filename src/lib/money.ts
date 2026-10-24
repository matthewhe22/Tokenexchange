export const MICROS_PER_USD = 1_000_000;

export function usdToMicros(usd: number): number {
  return Math.round(usd * MICROS_PER_USD);
}

export function formatUsd(micros: number): string {
  const usd = Math.abs(micros / MICROS_PER_USD);
  // Small amounts (single requests) need more precision than balances.
  const digits = usd === 0 || usd >= 1 ? 2 : usd >= 0.01 ? 4 : 6;
  return (micros < 0 ? "-$" : "$") + usd.toFixed(digits);
}
