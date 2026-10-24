import { redirect } from "next/navigation";
import type { schema } from "@/db";
import { createPendingTwoFactor, createSession } from "./session";

type User = typeof schema.users.$inferSelect;

export function safeNext(next: string | null | undefined): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

/** Finishes a successful first factor: either signs in, or sends users with 2FA to the code step. */
export async function completeLogin(user: User, next?: string | null): Promise<never> {
  const target = safeNext(next) ?? (user.role === "admin" ? "/admin" : "/dashboard");
  if (user.totpEnabledAt) {
    await createPendingTwoFactor(user.id, user.sessionVersion);
    redirect(`/login/2fa?next=${encodeURIComponent(target)}`);
  }
  await createSession(user.id, user.sessionVersion);
  redirect(target);
}
