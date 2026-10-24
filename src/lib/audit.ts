import { getDb, schema } from "@/db";
import { clientIp } from "./client-ip";

/** Records an admin action. Never pass secrets in `details`. Failures are logged, not thrown. */
export async function audit(actor: { id: number; email: string }, action: string, target: string | null, details?: unknown): Promise<void> {
  try {
    await getDb()
      .insert(schema.auditLogs)
      .values({
        actorId: actor.id,
        actorEmail: actor.email,
        action,
        target,
        details: details ?? null,
        ip: await clientIp(),
      });
  } catch (err) {
    console.error("audit log write failed", action, err);
  }
}
