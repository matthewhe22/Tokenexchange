import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { SOURCES, type Source } from "@/db/schema";
import { cached, invalidate } from "./cache";

export interface RoutingSettings {
  /** Procurement sources that may serve traffic at all. */
  enabledSources: Source[];
  /** Optional per-model restriction, e.g. { "claude-opus-4-1": ["official", "cloud"] }. */
  modelSources: Record<string, Source[]>;
  /** How many channels to try before giving up on a request. */
  maxAttempts: number;
}

export const DEFAULT_ROUTING: RoutingSettings = { enabledSources: [...SOURCES], modelSources: {}, maxAttempts: 3 };

export async function getRoutingSettings(): Promise<RoutingSettings> {
  return cached("settings:routing", async () => {
    const [row] = await getDb().select().from(schema.settings).where(eq(schema.settings.key, "routing"));
    return { ...DEFAULT_ROUTING, ...((row?.value as Partial<RoutingSettings>) ?? {}) };
  });
}

export async function saveRoutingSettings(value: RoutingSettings): Promise<void> {
  await getDb()
    .insert(schema.settings)
    .values({ key: "routing", value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
  invalidate("settings:");
}
