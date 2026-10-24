"use server";

import bcrypt from "bcryptjs";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { consumeAuthToken, issueAuthToken } from "@/lib/auth-tokens";
import { clientIp } from "@/lib/client-ip";
import { decrypt } from "@/lib/crypto";
import { emailEnabled, sendEmail } from "@/lib/email";
import { completeLogin, safeNext } from "@/lib/login";
import { hit, peek } from "@/lib/ratelimit";
import { consumeRecoveryCode } from "@/lib/recovery-codes";
import {
  bumpSessionVersion,
  clearPendingTwoFactor,
  createSession,
  destroySession,
  readPendingTwoFactor,
  requireUser,
} from "@/lib/session";
import { verifyTotp } from "@/lib/totp";
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

const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

/** Brute-force protection: every bucket must be under its limit. */
async function throttled(...buckets: [string, number, number][]): Promise<boolean> {
  for (const [bucket, limit, windowSec] of buckets) {
    if (!(await hit(bucket, limit, windowSec)).ok) return true;
  }
  return false;
}

async function sendVerification(userId: number, email: string) {
  const token = await issueAuthToken(userId, "verify_email", 24 * HOUR);
  await sendEmail({
    to: email,
    subject: "Verify your TokenExchange email",
    text: `Welcome to TokenExchange!\n\nConfirm your email address to start creating API keys:\n${appUrl()}/verify-email?token=${token}\n\nThis link expires in 24 hours.`,
  });
}

// Failed-password limits count failures only, so nobody can lock a user out with a few bad
// guesses from elsewhere: 10 per email per IP, and a high cap of 50 per email across all IPs.
const FAIL_WINDOW = 900;

export async function login(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  const ip = await clientIp();
  if (await throttled([`login:ip:${ip}`, 30, 300])) return { error: TOO_MANY, email };
  if ((await peek(`login:fail:${email}:${ip}`, FAIL_WINDOW)) >= 10 || (await peek(`login:fail:${email}`, FAIL_WINDOW)) >= 50) {
    return { error: TOO_MANY, email };
  }
  const [user] = await getDb().select().from(schema.users).where(eq(schema.users.email, email));
  if (!user || user.disabled || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    await hit(`login:fail:${email}:${ip}`, 10, FAIL_WINDOW);
    await hit(`login:fail:${email}`, 50, FAIL_WINDOW);
    return { error: "Invalid email or password", email };
  }
  return completeLogin(user, str(form, "next"));
}

const TWO_FA_FAIL_WINDOW = 3600;
const TWO_FA_MAX_FAILURES = 10;

export async function verifyTwoFactor(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  const user = await readPendingTwoFactor();
  if (!user || !user.totpSecret) return { error: "Your sign-in expired. Please sign in again." };
  // Failures only, per account, over an hour: ~10 guesses against 3 valid codes each.
  if ((await peek(`2fa:fail:${user.id}`, TWO_FA_FAIL_WINDOW)) >= TWO_FA_MAX_FAILURES) {
    return { error: "Too many wrong codes. Try again in an hour, or use a recovery code." };
  }
  const code = str(form, "code");
  let ok = false;
  const step = verifyTotp(decrypt(user.totpSecret), code, user.totpLastStep);
  if (step != null) {
    // Record the step atomically so the same code cannot be used twice, even concurrently.
    const [claimed] = await getDb()
      .update(schema.users)
      .set({ totpLastStep: step })
      .where(and(eq(schema.users.id, user.id), or(isNull(schema.users.totpLastStep), lt(schema.users.totpLastStep, step))))
      .returning({ id: schema.users.id });
    ok = !!claimed;
  } else {
    ok = await consumeRecoveryCode(user.id, code);
  }
  if (!ok) {
    const fails = await hit(`2fa:fail:${user.id}`, TWO_FA_MAX_FAILURES, TWO_FA_FAIL_WINDOW);
    if (fails.count === TWO_FA_MAX_FAILURES) {
      await sendEmail({
        to: user.email,
        subject: "Repeated failed sign-in attempts on your TokenExchange account",
        text: `Someone entered your password correctly but failed the two-factor code ${TWO_FA_MAX_FAILURES} times. Sign-in is paused for an hour.\n\nIf this was not you, change your password now: ${appUrl()}/forgot-password`,
      }).catch(() => {});
    }
    return { error: "That code is not valid. Check your authenticator app and try again." };
  }
  await clearPendingTwoFactor();
  await createSession(user.id, user.sessionVersion, { mfa: true });
  redirect(safeNext(str(form, "next")) ?? (user.role === "admin" ? "/admin" : "/dashboard"));
}

export async function signup(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  if (!(await verifyTurnstile(str(form, "cf-turnstile-response") || null, await clientIp()))) {
    return { error: "Please complete the verification challenge", email };
  }
  if (await throttled([`signup:ip:${await clientIp()}`, 10, 3600])) return { error: TOO_MANY, email };
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
  const ip = await clientIp();
  // Per email *and* IP, so a third party cannot exhaust a user's reset emails.
  if (await throttled([`forgot:ip:${ip}`, 5, 900], [`forgot:email:${email}:${ip}`, 3, 3600], [`forgot:email:${email}`, 20, 3600])) {
    return { error: TOO_MANY, email };
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
  // The reset link proves control of the inbox, so it also verifies the address.
  await bumpSessionVersion(userId, { passwordHash: await bcrypt.hash(password, 10), emailVerifiedAt: user?.emailVerifiedAt ?? new Date() });
  redirect("/login?reset=1");
}
