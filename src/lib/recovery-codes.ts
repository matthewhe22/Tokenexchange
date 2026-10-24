import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { sha256 } from "./crypto";

const normalize = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Ten single-use codes for when the authenticator is lost. Only hashes are stored. */
export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: 10 }, () => {
    const s = randomBytes(5).toString("hex");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  return { codes, hashes: codes.map((c) => sha256(normalize(c))) };
}

/** Uses up a recovery code atomically; true if it was valid and unused. */
export async function consumeRecoveryCode(userId: number, code: string): Promise<boolean> {
  const hash = sha256(normalize(code));
  if (normalize(code).length !== 10) return false;
  const [row] = await getDb()
    .update(schema.users)
    .set({ totpRecoveryCodes: sql`array_remove(${schema.users.totpRecoveryCodes}, ${hash})` })
    .where(and(eq(schema.users.id, userId), sql`${hash} = any(${schema.users.totpRecoveryCodes})`))
    .returning({ id: schema.users.id });
  return !!row;
}
