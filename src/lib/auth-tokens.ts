import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { sha256 } from "./crypto";

type Purpose = (typeof schema.authTokens.$inferInsert)["purpose"];

export async function issueAuthToken(userId: number, purpose: Purpose, ttlMs: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await getDb()
    .insert(schema.authTokens)
    .values({ userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

/** Marks the token used and returns its user, or null if it is unknown, expired or already used. */
export async function consumeAuthToken(token: string, purpose: Purpose): Promise<number | null> {
  const [row] = await getDb()
    .update(schema.authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.authTokens.tokenHash, sha256(token)),
        eq(schema.authTokens.purpose, purpose),
        isNull(schema.authTokens.usedAt),
        gt(schema.authTokens.expiresAt, new Date()),
      ),
    )
    .returning();
  return row?.userId ?? null;
}
