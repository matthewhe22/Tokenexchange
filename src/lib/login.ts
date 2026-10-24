import { redirect } from "next/navigation";
import type { schema } from "@/db";
import { createPendingTwoFactor, createSession } from "./session";

type User = typeof schema.users.$inferSelect;

/**
 * A same-site path to continue to after sign-in, or null. Browsers treat "\\" like "/" and ignore
 * tabs/newlines in URLs, so "/\\evil.com" or "/\t/evil.com" would leave the site; reject them.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || /[\\\x00-\x1f\x7f]/.test(next)) return null;
  try {
    const base = "https://tokenexchange.invalid";
    const url = new URL(next, base);
    return url.origin === base ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
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
