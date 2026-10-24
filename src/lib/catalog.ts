import { getPrices, type ModelPrice } from "./billing";

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

/** Customer-facing prices (list x markup) in USD per 1M tokens, grouped by vendor. */
export async function publicPriceList(): Promise<PublicPrice[]> {
  const order: Vendor[] = ["OpenAI", "Anthropic", "Google", "Other"];
  return [...(await getPrices()).values()]
    .filter((p) => p.enabled)
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
