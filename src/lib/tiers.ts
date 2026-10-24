import type { ModelPrice } from "./billing";

/** How a request is processed upstream, which decides what it costs. */
export type Tier = "standard" | "flex" | "priority" | "batch";

/** What the vendors charge for flex processing and batches, relative to list (OpenAI, Anthropic, Azure: 50%). */
export const DISCOUNTED_LIST_FACTOR = 0.5;

export interface TierFactors {
  /** Customer price as a multiple of list. */
  sell: number;
  /** Upstream price as a multiple of list, before the channel's cost multiplier. */
  list: number;
}

/** Price factors for `tier`, or null when the model is not offered on that tier. */
export function tierFactors(price: ModelPrice, tier: Tier): TierFactors | null {
  switch (tier) {
    case "standard":
      return { sell: price.markup, list: 1 };
    case "flex":
      return price.flexMarkup == null ? null : { sell: price.flexMarkup, list: DISCOUNTED_LIST_FACTOR };
    case "batch":
      return price.batchMarkup == null ? null : { sell: price.batchMarkup, list: DISCOUNTED_LIST_FACTOR };
    case "priority":
      return price.priorityMultiplier == null ? null : { sell: price.priorityMultiplier * price.markup, list: price.priorityMultiplier };
  }
}

/** Tier an OpenAI response says it ran on (`service_tier`); anything else is billed as standard. */
export function reportedTier(value: unknown): Tier | null {
  if (value === "flex") return "flex";
  if (value === "priority") return "priority";
  if (typeof value === "string") return "standard";
  return null;
}

/**
 * Decides the tier of a relayed request and rewrites the body to match. Customers only get a tier
 * the model is offered on; anything else (including `auto` and Anthropic's own `service_tier`) is
 * removed, so a client can never make us pay a higher upstream price than we bill.
 */
export function applyRequestedTier(protocol: string, body: Record<string, unknown>, price: ModelPrice): Tier {
  const requested = body.service_tier;
  delete body.service_tier;
  if (protocol === "gemini") delete body.serviceTier;
  if (protocol !== "openai-chat" && protocol !== "openai-responses") return "standard";
  if (requested === "flex" && price.flexMarkup != null) {
    body.service_tier = "flex";
    return "flex";
  }
  if (requested === "priority" && price.priorityMultiplier != null) {
    body.service_tier = "priority";
    return "priority";
  }
  return "standard";
}
