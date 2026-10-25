// Live model and price lists of per-token upstreams (DeepInfra, Novita), used to import models and
// keep each channel's per-model costs current.
import type { ModelCost } from "@/db/schema";
import { openaiEndpoint } from "@/relay/providers";
import type { LoadedChannel } from "./channels";

export const CATALOGS = ["deepinfra", "novita"] as const;
export type CatalogKind = (typeof CATALOGS)[number];

export interface CatalogModel {
  /** The upstream's model id, e.g. meta-llama/Llama-3.3-70B-Instruct-Turbo */
  id: string;
  cost: ModelCost;
  contextSize: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * DeepInfra `GET /models/list` (public): `pricing.cents_per_input_token` etc. in US cents per token,
 * so USD per 1M tokens = cents x 10,000. `rate_per_input_token_cached` is a multiple of the input
 * price; values outside (0, 1] are ignored rather than guessed at.
 */
export function parseDeepInfra(items: unknown): CatalogModel[] {
  if (!Array.isArray(items)) throw new Error("unexpected DeepInfra catalog response");
  const out: CatalogModel[] = [];
  for (const m of items) {
    if (m?.type !== "text-generation" || m.deprecated || m.private || typeof m.model_name !== "string") continue;
    const inCents = num(m.pricing?.cents_per_input_token);
    const outCents = num(m.pricing?.cents_per_output_token);
    if (inCents == null || outCents == null) continue;
    const input = round(inCents * 10_000);
    const cost: ModelCost = { input, output: round(outCents * 10_000) };
    const cached = num(m.pricing?.rate_per_input_token_cached);
    if (cached != null && cached > 0 && cached <= 1) cost.cacheRead = round(input * cached);
    out.push({ id: m.model_name, cost, contextSize: num(m.max_tokens) });
  }
  return out;
}

/**
 * Novita `GET /openai/v1/models`: `input_token_price_per_m` / `output_token_price_per_m` are integers
 * in units of 0.0001 USD per 1M tokens (their docs show 3900 for Llama 3.3 70B at $0.39).
 */
export function parseNovita(body: unknown): CatalogModel[] {
  const items = (body as { data?: unknown })?.data;
  if (!Array.isArray(items)) throw new Error("unexpected Novita catalog response");
  const out: CatalogModel[] = [];
  for (const m of items) {
    const input = num(m?.input_token_price_per_m);
    const output = num(m?.output_token_price_per_m);
    if (typeof m?.id !== "string" || input == null || output == null) continue;
    out.push({ id: m.id, cost: { input: round(input / 10_000), output: round(output / 10_000) }, contextSize: num(m.context_size) });
  }
  return out;
}

const round = (usd: number) => Math.round(usd * 1e6) / 1e6;

export function catalogKind(ch: Pick<LoadedChannel, "config">): CatalogKind | null {
  const k = ch.config.catalog;
  return (CATALOGS as readonly string[]).includes(k) ? (k as CatalogKind) : null;
}

/** Fetches the channel's upstream catalog (text models with token prices), sorted by id. */
export async function fetchCatalog(ch: LoadedChannel): Promise<CatalogModel[]> {
  const kind = catalogKind(ch);
  if (!kind) throw new Error("this channel has no upstream catalog");
  const { base, headers, query } = openaiEndpoint(ch);
  // DeepInfra's catalog lives at the API root (…/models/list), not under /v1/openai.
  const url = kind === "deepinfra" ? `${new URL(base).origin}/models/list` : `${base}/models${query}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`catalog request failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const body = await res.json();
  const models = kind === "deepinfra" ? parseDeepInfra(body) : parseNovita(body);
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

/** A public model name for an upstream id: the last path segment, lower-cased. */
export function suggestPublicName(id: string): string {
  return (id.split("/").pop() ?? id).toLowerCase().replace(/-turbo$/, "");
}
