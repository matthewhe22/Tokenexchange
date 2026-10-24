import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { sha256 } from "@/lib/crypto";

export type ApiKeyRow = typeof schema.apiKeys.$inferSelect;
export type UserRow = typeof schema.users.$inferSelect;

/** Accepts the auth styles of all supported SDKs: OpenAI (Bearer), Anthropic (x-api-key), Gemini (x-goog-api-key / ?key=). */
export function extractApiKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim() || null;
  return req.headers.get("x-api-key") ?? req.headers.get("x-goog-api-key") ?? new URL(req.url).searchParams.get("key");
}

export type AuthResult =
  | { ok: true; user: UserRow; apiKey: ApiKeyRow }
  | { ok: false; status: number; message: string };

export async function authenticateApiKey(key: string): Promise<AuthResult> {
  const [row] = await getDb()
    .select({ apiKey: schema.apiKeys, user: schema.users })
    .from(schema.apiKeys)
    .innerJoin(schema.users, eq(schema.apiKeys.userId, schema.users.id))
    .where(eq(schema.apiKeys.keyHash, sha256(key)))
    .limit(1);
  if (!row) return { ok: false, status: 401, message: "invalid API key" };
  if (!row.apiKey.enabled) return { ok: false, status: 401, message: "API key is disabled" };
  if (row.apiKey.expiresAt && row.apiKey.expiresAt < new Date()) return { ok: false, status: 401, message: "API key has expired" };
  if (row.user.disabled) return { ok: false, status: 403, message: "account is disabled" };
  return { ok: true, user: row.user, apiKey: row.apiKey };
}
