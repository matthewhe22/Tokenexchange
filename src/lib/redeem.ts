import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { base32Encode } from "./totp";
import { sha256 } from "./crypto";
import { rearmLowBalanceSql } from "./notifications";

/** Normalises user input: case-insensitive, dashes and spaces optional. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

function newCode(): string {
  const body = base32Encode(randomBytes(10)); // 16 chars, 80 bits
  return `TX-${body.match(/.{4}/g)!.join("-")}`;
}

export async function generateRedeemCodes(opts: {
  count: number;
  amount: number;
  maxUses: number;
  expiresAt: Date | null;
  batch: string | null;
  createdBy: number;
}): Promise<string[]> {
  const codes = Array.from({ length: opts.count }, newCode);
  await getDb()
    .insert(schema.redeemCodes)
    .values(
      codes.map((c) => ({
        codeHash: sha256(normalizeCode(c)),
        codePrefix: c.slice(0, 7),
        amount: opts.amount,
        maxUses: opts.maxUses,
        expiresAt: opts.expiresAt,
        batch: opts.batch,
        createdBy: opts.createdBy,
      })),
    );
  return codes;
}

export type RedeemResult = { ok: true; amount: number } | { ok: false; error: string };

/** Credits the code's amount to the user. Each user can redeem a given code once. */
export async function redeemCode(userId: number, code: string): Promise<RedeemResult> {
  const hash = sha256(normalizeCode(code));
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(schema.redeemCodes).where(eq(schema.redeemCodes.codeHash, hash)).for("update");
    if (!row) return { ok: false, error: "That code is not valid." } as const;
    if (row.expiresAt && row.expiresAt < new Date()) return { ok: false, error: "That code has expired." } as const;
    if (row.usedCount >= row.maxUses) return { ok: false, error: "That code has already been used." } as const;
    const inserted = await tx
      .insert(schema.balanceTransactions)
      .values({ userId, amount: row.amount, type: "redeem", reference: `redeem:${row.id}:${userId}`, note: `Redeemed code ${row.codePrefix}…` })
      .onConflictDoNothing({ target: schema.balanceTransactions.reference })
      .returning({ id: schema.balanceTransactions.id });
    if (!inserted.length) return { ok: false, error: "You have already redeemed this code." } as const;
    await tx.update(schema.redeemCodes).set({ usedCount: sql`${schema.redeemCodes.usedCount} + 1` }).where(and(eq(schema.redeemCodes.id, row.id)));
    await tx
      .update(schema.users)
      .set({ balance: sql`${schema.users.balance} + ${row.amount}`, lowBalanceNotifiedAt: await rearmLowBalanceSql(row.amount) })
      .where(eq(schema.users.id, userId));
    return { ok: true, amount: row.amount } as const;
  });
}
