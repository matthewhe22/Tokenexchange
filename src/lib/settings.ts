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
  /** Disable a channel after this many consecutive failures (0 = never). */
  autoDisableAfter: number;
  /** Keep each API key + model on the same channel so upstream prompt caches keep hitting. */
  affinity: boolean;
  /** Serve OpenAI Chat Completions requests from Anthropic / Gemini channels by translating them. */
  allowConversion: boolean;
}

export const DEFAULT_ROUTING: RoutingSettings = { enabledSources: [...SOURCES], modelSources: {}, maxAttempts: 3, autoDisableAfter: 0, affinity: true, allowConversion: true };

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

export interface LimitSettings {
  /** Requests per minute per API key unless the key sets its own limit (0 = unlimited). */
  defaultKeyRpm: number;
  /** Requests per minute across all of a user's keys (0 = unlimited). */
  userRpm: number;
}

// Off by default so enabling the feature never surprises existing customers; set limits in the admin console.
export const DEFAULT_LIMITS: LimitSettings = { defaultKeyRpm: 0, userRpm: 0 };

export async function getLimitSettings(): Promise<LimitSettings> {
  return cached("settings:limits", async () => {
    const [row] = await getDb().select().from(schema.settings).where(eq(schema.settings.key, "limits"));
    return { ...DEFAULT_LIMITS, ...((row?.value as Partial<LimitSettings>) ?? {}) };
  });
}

export async function saveLimitSettings(value: LimitSettings): Promise<void> {
  await getDb()
    .insert(schema.settings)
    .values({ key: "limits", value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
  invalidate("settings:");
}

export interface SecuritySettings {
  /** Admins without two-factor auth are sent to set it up before they can use the admin console. */
  requireAdmin2fa: boolean;
  /** Default low-balance email threshold in micro-USD (0 = off); users can override it. */
  lowBalanceDefault: number;
}

export const DEFAULT_SECURITY: SecuritySettings = { requireAdmin2fa: false, lowBalanceDefault: 5_000_000 };

export async function getSecuritySettings(): Promise<SecuritySettings> {
  return cached("settings:security", async () => {
    const [row] = await getDb().select().from(schema.settings).where(eq(schema.settings.key, "security"));
    return { ...DEFAULT_SECURITY, ...((row?.value as Partial<SecuritySettings>) ?? {}) };
  });
}

export async function saveSecuritySettings(value: SecuritySettings): Promise<void> {
  await getDb()
    .insert(schema.settings)
    .values({ key: "security", value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
  invalidate("settings:");
}
