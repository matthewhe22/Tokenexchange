// Price benchmark: OpenRouter's public model list, to see where our prices are above the market.
import type { ModelPrice } from "./billing";
import { cached } from "./cache";
import { tierFactors } from "./tiers";

export interface BenchmarkPrice {
  id: string;
  /** USD per 1M tokens */
  input: number;
  output: number;
}

// Overridable for tests; OpenRouter's list is public and needs no key.
const MODELS_URL = () => process.env.BENCHMARK_MODELS_URL ?? "https://openrouter.ai/api/v1/models";

/**
 * Parses OpenRouter's `GET /api/v1/models`: `pricing.prompt` / `pricing.completion` are USD per
 * token as strings. Free and variable-priced entries (0 or negative, e.g. routers) are skipped.
 */
export function parseOpenRouter(body: unknown): BenchmarkPrice[] {
  const items = (body as { data?: unknown })?.data;
  if (!Array.isArray(items)) throw new Error("unexpected OpenRouter response");
  const out: BenchmarkPrice[] = [];
  for (const m of items) {
    const input = Number(m?.pricing?.prompt);
    const output = Number(m?.pricing?.completion);
    if (typeof m?.id !== "string" || !(input > 0) || !(output >= 0) || m.id.endsWith(":free")) continue;
    out.push({ id: m.id, input: round(input * 1e6), output: round(output * 1e6) });
  }
  return out;
}

const round = (usd: number) => Math.round(usd * 1e6) / 1e6;

/** Comparable form of a model name: no vendor prefix, lower case, dots and underscores as dashes. */
export function normalizeModel(name: string): string {
  return (name.split("/").pop() ?? name).toLowerCase().replace(/[._\s]+/g, "-");
}

/** Index for matching: normalized name, and the same without a trailing -instruct. */
export function benchmarkIndex(prices: BenchmarkPrice[]): Map<string, BenchmarkPrice> {
  const index = new Map<string, BenchmarkPrice>();
  for (const p of prices) {
    index.set(`id:${p.id}`, p);
    for (const key of [normalizeModel(p.id), normalizeModel(p.id).replace(/-instruct$/, "")]) {
      // Keep the cheapest listing when several vendors publish the same model name.
      const prev = index.get(key);
      if (!prev || blended(p) < blended(prev)) index.set(key, p);
    }
  }
  return index;
}

export function matchBenchmark(model: string, benchmarkId: string | null, index: Map<string, BenchmarkPrice>): BenchmarkPrice | null {
  if (benchmarkId) return index.get(`id:${benchmarkId}`) ?? null;
  const n = normalizeModel(model);
  return index.get(n) ?? index.get(n.replace(/-instruct$/, "")) ?? null;
}

/** USD per 1M tokens at 3 input : 1 output, a typical chat mix. */
export const blended = (p: { input: number; output: number }) => (3 * p.input + p.output) / 4;

export async function fetchBenchmark(): Promise<Map<string, BenchmarkPrice>> {
  return cached(
    "benchmark:openrouter",
    async () => {
      // Short timeout: admin pages wait for this.
      const res = await fetch(MODELS_URL(), { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`OpenRouter model list: HTTP ${res.status}`);
      return benchmarkIndex(parseOpenRouter(await res.json()));
    },
    60 * 60_000,
  );
}

export interface PriceComparison {
  model: string;
  bench: BenchmarkPrice | null;
  ours: { input: number; output: number };
  batch: { input: number; output: number } | null;
  /** Our blended price ÷ the benchmark's, minus 1 (0.2 = 20% more expensive). */
  diff: number | null;
  batchDiff: number | null;
}

export function compare(price: ModelPrice, bench: BenchmarkPrice | null): PriceComparison {
  const ours = { input: price.inputPrice * price.markup, output: price.outputPrice * price.markup };
  const b = tierFactors(price, "batch");
  const batch = b ? { input: price.inputPrice * b.sell, output: price.outputPrice * b.sell } : null;
  const ref = bench && blended(bench) > 0 ? blended(bench) : null;
  return {
    model: price.model,
    bench,
    ours,
    batch,
    diff: ref ? blended(ours) / ref - 1 : null,
    batchDiff: ref && batch ? blended(batch) / ref - 1 : null,
  };
}

/** Every enabled price compared with OpenRouter, most overpriced first. */
export async function compareWithBenchmark(prices: ModelPrice[]): Promise<{ rows: PriceComparison[]; error: string | null }> {
  let index: Map<string, BenchmarkPrice>;
  try {
    index = await fetchBenchmark();
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
  const rows = prices
    .filter((p) => p.enabled && p.inputPrice + p.outputPrice > 0)
    .map((p) => compare(p, matchBenchmark(p.model, p.benchmarkId, index)))
    .sort((a, b) => (b.diff ?? -Infinity) - (a.diff ?? -Infinity) || a.model.localeCompare(b.model));
  return { rows, error: null };
}
