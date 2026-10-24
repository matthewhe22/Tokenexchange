export const MICROS_PER_USD = 1_000_000;

export function usdToMicros(usd: number): number {
  return Math.round(usd * MICROS_PER_USD);
}

export function formatUsd(micros: number): string {
  const usd = micros / MICROS_PER_USD;
  return (usd < 0 ? "-$" : "$") + Math.abs(usd).toFixed(Math.abs(usd) < 1 ? 6 : 2);
}
