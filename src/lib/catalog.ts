import { getPrices, type ModelPrice } from "./billing";
import { servedModels } from "./channels";

export type Vendor = "OpenAI" | "Anthropic" | "Google" | "Other";

export function vendorOf(model: string): Vendor {
  if (/^(gpt|o\d|chatgpt|text-embedding|dall-e|whisper|tts)/i.test(model)) return "OpenAI";
  if (/^claude/i.test(model)) return "Anthropic";
  if (/^(gemini|gemma|imagen|text-embedding-00)/i.test(model)) return "Google";
  return "Other";
}

export interface PublicPrice {
  model: string;
  vendor: Vendor;
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  perUnit: number | null;
  tier: { threshold: number; input: number; output: number } | null;
  /** Discounted tiers: input / output USD per 1M tokens. */
  batch: { input: number; output: number } | null;
  flex: { input: number; output: number } | null;
}

/**
 * Customer-facing prices (list x markup) in USD per 1M tokens, grouped by vendor. Only models an
 * enabled channel serves are listed, and a batch price only where a batch-capable channel does.
 */
export async function publicPriceList(): Promise<PublicPrice[]> {
  const order: Vendor[] = ["OpenAI", "Anthropic", "Google", "Other"];
  const [prices, served] = await Promise.all([getPrices(), servedModels()]);
  return [...prices.values()]
    .filter((p) => p.enabled && served.live.has(p.model))
    .map((p) => (served.batch.has(p.model) ? p : { ...p, batchMarkup: null }))
    .map((p: ModelPrice) => ({
      model: p.model,
      vendor: vendorOf(p.model),
      input: p.inputPrice * p.markup,
      output: p.outputPrice * p.markup,
      cacheRead: p.cacheReadPrice != null ? p.cacheReadPrice * p.markup : null,
      cacheWrite: p.cacheWritePrice != null ? p.cacheWritePrice * p.markup : null,
      perUnit: p.perRequestPrice != null ? p.perRequestPrice * p.markup : null,
      tier:
        p.tierThreshold != null
          ? { threshold: p.tierThreshold, input: (p.tierInputPrice ?? p.inputPrice) * p.markup, output: (p.tierOutputPrice ?? p.outputPrice) * p.markup }
          : null,
      batch: p.batchMarkup != null ? { input: p.inputPrice * p.batchMarkup, output: p.outputPrice * p.batchMarkup } : null,
      flex: p.flexMarkup != null ? { input: p.inputPrice * p.flexMarkup, output: p.outputPrice * p.flexMarkup } : null,
    }))
    .sort((a, b) => order.indexOf(a.vendor) - order.indexOf(b.vendor) || a.model.localeCompare(b.model));
}

export function perMillion(usd: number | null): string {
  if (usd == null) return "—";
  return "$" + usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export interface BatchDeal {
  model: string;
  vendor: Vendor;
  realtime: { input: number; output: number };
  batch: { input: number; output: number };
  /** Fraction saved against the real-time price, e.g. 0.333 */
  saving: number;
}

/** Models offered as batches, biggest saving first. Savings are against our own real-time price. */
export function batchDeals(prices: PublicPrice[]): BatchDeal[] {
  return prices
    .filter((p) => p.batch && p.input > 0)
    .map((p) => ({
      model: p.model,
      vendor: p.vendor,
      realtime: { input: p.input, output: p.output },
      batch: p.batch!,
      saving: Math.max(0, 1 - p.batch!.input / p.input),
    }))
    .filter((d) => d.saving > 0)
    .sort((a, b) => b.saving - a.saving || a.model.localeCompare(b.model));
}

/** Whole-percent headline saving ("up to N%"), or null when no model has a batch discount. */
export function maxBatchSaving(deals: BatchDeal[]): number | null {
  return deals.length ? Math.floor(deals[0].saving * 100) : null;
}
