import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { sha256 } from "@/lib/crypto";
import { currentUser } from "@/lib/session";
import { relayError } from "@/relay/errors";
import { relay } from "@/relay/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PLAYGROUND_KEY_NAME = "Playground";

/**
 * Chat Completions for the signed-in user, billed like any API call through a per-user
 * "Playground" key whose secret is never shown (it only exists so usage is attributed).
 */
export async function POST(req: Request) {
  // Session cookies are SameSite=Lax, but also refuse cross-site callers explicitly.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return new Response("forbidden", { status: 403 });
  const user = await currentUser();
  if (!user) return relayError("openai-chat", 401, "sign in to use the playground");
  if (!user.emailVerifiedAt) return relayError("openai-chat", 403, "verify your email address first");

  const db = getDb();
  const where = and(eq(schema.apiKeys.userId, user.id), eq(schema.apiKeys.name, PLAYGROUND_KEY_NAME));
  let [apiKey] = await db.select().from(schema.apiKeys).where(where);
  if (!apiKey) {
    const secret = randomBytes(32).toString("base64url");
    [apiKey] = await db
      .insert(schema.apiKeys)
      .values({ userId: user.id, name: PLAYGROUND_KEY_NAME, keyHash: sha256(`playground:${secret}`), keyPrefix: "playground" })
      .returning();
  }
  if (!apiKey.enabled) return relayError("openai-chat", 403, "the Playground key is disabled on your API keys page");
  return relay(req, "openai-chat", { endpoint: "/playground", principal: { user, apiKey } });
}
