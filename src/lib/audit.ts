import { headers } from "next/headers";
import { getDb, schema } from "@/db";

/** Records an admin action. Never pass secrets in `details`. Failures are logged, not thrown. */
export async function audit(actor: { id: number; email: string }, action: string, target: string | null, details?: unknown): Promise<void> {
  try {
    const h = await headers();
    await getDb()
      .insert(schema.auditLogs)
      .values({
        actorId: actor.id,
        actorEmail: actor.email,
        action,
        target,
        details: details ?? null,
        ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      });
  } catch (err) {
    console.error("audit log write failed", action, err);
  }
}
