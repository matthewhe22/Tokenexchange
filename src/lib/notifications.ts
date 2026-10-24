import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { sendEmail } from "./email";
import { formatUsd } from "./money";
import { getSecuritySettings } from "./settings";
import { appUrl } from "./url";

/**
 * Emails the user once when their balance drops below their threshold. The "notified" flag is
 * claimed atomically so concurrent requests send one email, and is cleared by the next top-up.
 */
export async function maybeNotifyLowBalance(userId: number, balance: number, threshold: number | null): Promise<void> {
  const limit = threshold ?? (await getSecuritySettings()).lowBalanceDefault;
  if (limit <= 0 || balance >= limit) return;
  const [claimed] = await getDb()
    .update(schema.users)
    .set({ lowBalanceNotifiedAt: new Date() })
    .where(and(eq(schema.users.id, userId), isNull(schema.users.lowBalanceNotifiedAt)))
    .returning({ email: schema.users.email });
  if (!claimed) return;
  await sendEmail({
    to: claimed.email,
    subject: `Your TokenExchange balance is below ${formatUsd(limit)}`,
    text: `Your balance is now ${formatUsd(Math.max(0, balance))}. Requests will be refused when it runs out.\n\nAdd credit: ${appUrl()}/dashboard/billing\n\nChange or turn off this alert: ${appUrl()}/dashboard/account`,
  });
}
