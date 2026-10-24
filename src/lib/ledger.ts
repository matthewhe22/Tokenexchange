import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { rearmLowBalanceSql } from "./notifications";

type TxType = (typeof schema.balanceTransactions.$inferInsert)["type"];

/**
 * Applies a balance change exactly once per `reference` (e.g. a Stripe session id), so
 * replayed webhooks are harmless. Returns false if the reference was already applied.
 */
export async function applyBalanceChange(e: { userId: number; amount: number; type: TxType; reference: string | null; note?: string }): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.balanceTransactions)
      .values({ userId: e.userId, amount: e.amount, type: e.type, reference: e.reference, note: e.note })
      .onConflictDoNothing({ target: schema.balanceTransactions.reference })
      .returning({ id: schema.balanceTransactions.id });
    if (!inserted.length) return false;
    await tx
      .update(schema.users)
      .set({ balance: sql`${schema.users.balance} + ${e.amount}`, lowBalanceNotifiedAt: await rearmLowBalanceSql(e.amount) })
      .where(eq(schema.users.id, e.userId));
    return true;
  });
}
