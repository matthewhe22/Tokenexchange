import { getDb, schema } from "@/db";
import type { ModelPrice } from "./billing";
import { cached, invalidate } from "./cache";

export type PricingGroup = typeof schema.pricingGroups.$inferSelect;

export async function getGroups(): Promise<Map<number, PricingGroup>> {
  return cached("groups", async () => new Map((await getDb().select().from(schema.pricingGroups)).map((g) => [g.id, g])));
}

/** The price a member of `groupId` pays: the model's markups times the group multiplier. */
export async function priceForGroup(price: ModelPrice, groupId: number | null): Promise<ModelPrice> {
  if (groupId == null) return price;
  const group = (await getGroups()).get(groupId);
  if (!group) return price;
  const m = group.multiplier;
  return {
    ...price,
    markup: price.markup * m,
    flexMarkup: price.flexMarkup == null ? null : price.flexMarkup * m,
    batchMarkup: price.batchMarkup == null ? null : price.batchMarkup * m,
  };
}

export function invalidateGroups(): void {
  invalidate("groups");
}
