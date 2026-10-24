"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { consumeAuthToken, issueAuthToken } from "@/lib/auth-tokens";
import { emailEnabled, sendEmail } from "@/lib/email";
import { bumpSessionVersion, createSession, destroySession, requireUser } from "@/lib/session";
import { verifyTurnstile } from "@/lib/turnstile";
import { appUrl } from "@/lib/url";

export interface FormState {
  error?: string;
  message?: string;
  email?: string;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUR = 60 * 60 * 1000;

async function clientIp(): Promise<string | null> {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

function safeNext(next: string): string | null {
  return next.startsWith("/") && !next.startsWith("//") ? next : null;
}

async function sendVerification(userId: number, email: string) {
  const token = await issueAuthToken(userId, "verify_email", 24 * HOUR);
  await sendEmail({
    to: email,
    subject: "Verify your TokenExchange email",
    text: `Welcome to TokenExchange!\n\nConfirm your email address to start creating API keys:\n${appUrl()}/verify-email?token=${token}\n\nThis link expires in 24 hours.`,
  });
}

export async function login(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  const [user] = await getDb().select().from(schema.users).where(eq(schema.users.email, email));
  if (!user || user.disabled || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "Invalid email or password", email };
  }
  await createSession(user.id, user.sessionVersion);
  redirect(safeNext(str(form, "next")) ?? (user.role === "admin" ? "/admin" : "/dashboard"));
}

export async function signup(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  if (!(await verifyTurnstile(str(form, "cf-turnstile-response") || null, await clientIp()))) {
    return { error: "Please complete the verification challenge", email };
  }
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address", email };
  if (password.length < 8) return { error: "Password must be at least 8 characters", email };

  const db = getDb();
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  if (existing) return { error: "An account with this email already exists. Sign in instead.", email };

  const [user] = await db
    .insert(schema.users)
    .values({ email, passwordHash: await bcrypt.hash(password, 10), emailVerifiedAt: emailEnabled() ? null : new Date() })
    .returning();
  if (emailEnabled()) await sendVerification(user.id, email);
  await createSession(user.id, user.sessionVersion);
  redirect("/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function resendVerification(): Promise<FormState> {
  const user = await requireUser();
  if (user.emailVerifiedAt) return { message: "Your email is already verified." };
  await sendVerification(user.id, user.email);
  return { message: `Verification email sent to ${user.email}.` };
}

export async function requestPasswordReset(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  if (!(await verifyTurnstile(str(form, "cf-turnstile-response") || null, await clientIp()))) {
    return { error: "Please complete the verification challenge", email };
  }
  const [user] = await getDb().select().from(schema.users).where(eq(schema.users.email, email));
  if (user && !user.disabled) {
    const token = await issueAuthToken(user.id, "reset_password", HOUR);
    await sendEmail({
      to: email,
      subject: "Reset your TokenExchange password",
      text: `Someone asked to reset the password for this account.\n\nChoose a new password here:\n${appUrl()}/reset-password?token=${token}\n\nThe link expires in 1 hour. If this wasn't you, ignore this email.`,
    });
  }
  // Same answer whether or not the account exists, so this form cannot be used to probe for emails.
  return { message: "If an account exists for that email, a reset link is on its way." };
}

export async function resetPassword(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  const password = str(form, "password");
  if (password.length < 8) return { error: "Password must be at least 8 characters" };
  const userId = await consumeAuthToken(str(form, "token"), "reset_password");
  if (!userId) return { error: "This reset link is invalid or has expired. Request a new one." };
  const db = getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  await db
    .update(schema.users)
    // The reset link proves control of the inbox, so it also verifies the address.
    .set({ passwordHash: await bcrypt.hash(password, 10), emailVerifiedAt: user?.emailVerifiedAt ?? new Date() })
    .where(eq(schema.users.id, userId));
  await bumpSessionVersion(userId);
  redirect("/login?reset=1");
}
