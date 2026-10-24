"use server";

import bcrypt from "bcryptjs";
import { and, count, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { decrypt, encrypt, generateApiKey, sha256 } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { generateRecoveryCodes } from "@/lib/recovery-codes";
import { generateTotpSecret, verifyTotp } from "@/lib/totp";
import { formatUsd, usdToMicros } from "@/lib/money";
import { hit } from "@/lib/ratelimit";
import { redeemCode } from "@/lib/redeem";
import { bumpSessionVersion, createSession, requireUser } from "@/lib/session";
import { createTopupCheckout, stripeEnabled } from "@/lib/stripe";

const MAX_KEYS = 20;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function createMyKey(_prev: unknown, form: FormData): Promise<{ key?: string; error?: string }> {
  const user = await requireUser();
  if (!user.emailVerifiedAt) return { error: "Verify your email address before creating API keys." };
  const db = getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.apiKeys).where(eq(schema.apiKeys.userId, user.id));
  if (n >= MAX_KEYS) return { error: `You can have at most ${MAX_KEYS} keys. Delete one first.` };

  const quota = str(form, "quota");
  if (quota && !(Number(quota) > 0)) return { error: "Spending limit must be a positive number" };
  const models = str(form, "allowedModels").split(",").map((s) => s.trim()).filter(Boolean);
  const key = generateApiKey();
  await db.insert(schema.apiKeys).values({
    userId: user.id,
    name: str(form, "name").slice(0, 60) || "default",
    keyHash: sha256(key),
    keyPrefix: key.slice(0, 12),
    quotaLimit: quota ? usdToMicros(Number(quota)) : null,
    allowedModels: models.length ? models : null,
  });
  revalidatePath("/dashboard/keys");
  return { key };
}

function ownKey(userId: number, form: FormData) {
  return and(eq(schema.apiKeys.id, Number(form.get("id"))), eq(schema.apiKeys.userId, userId));
}

export async function toggleMyKey(form: FormData) {
  const user = await requireUser();
  await getDb().update(schema.apiKeys).set({ enabled: sql`not ${schema.apiKeys.enabled}` }).where(ownKey(user.id, form));
  revalidatePath("/dashboard/keys");
}

export async function deleteMyKey(form: FormData) {
  const user = await requireUser();
  await getDb().delete(schema.apiKeys).where(ownKey(user.id, form));
  revalidatePath("/dashboard/keys");
}

export async function startTopup(form: FormData) {
  const user = await requireUser();
  if (!stripeEnabled()) redirect("/dashboard/billing?status=unavailable");
  const amount = Number(str(form, "custom") || str(form, "amount"));
  let url: string;
  try {
    url = await createTopupCheckout(user, amount);
  } catch (err) {
    console.error("checkout failed", err);
    redirect(`/dashboard/billing?status=error`);
  }
  redirect(url);
}

export async function changePassword(_prev: unknown, form: FormData): Promise<{ error?: string; message?: string }> {
  const user = await requireUser();
  const current = str(form, "current");
  const next = str(form, "password");
  if (!user.passwordHash || !(await bcrypt.compare(current, user.passwordHash))) return { error: "Current password is incorrect" };
  if (next.length < 8) return { error: "New password must be at least 8 characters" };
  // Sign out every other device, then re-issue this browser's session at the new version.
  const version = await bumpSessionVersion(user.id, { passwordHash: await bcrypt.hash(next, 10) });
  await createSession(user.id, version);
  return { message: "Password updated. Other devices have been signed out." };
}

export async function signOutEverywhere() {
  const user = await requireUser();
  await bumpSessionVersion(user.id);
  redirect("/login");
}

// ---------- two-factor auth ----------

type TotpState = { error?: string; message?: string; recoveryCodes?: string[] };
const FRESH_SESSION_MS = 10 * 60 * 1000;

/** Re-authentication for security changes: the password, or a sign-in in the last 10 minutes for OAuth-only accounts. */
async function reauthenticated(user: Awaited<ReturnType<typeof requireUser>>, form: FormData): Promise<boolean> {
  if (user.passwordHash) return bcrypt.compare(str(form, "password"), user.passwordHash);
  return Date.now() - user.sessionIssuedAt < FRESH_SESSION_MS;
}

async function auditSelf(user: { id: number; email: string }, action: string) {
  await audit(user, action, `user:${user.id}`);
}

export async function startTotpSetup(_prev: unknown, form: FormData): Promise<TotpState> {
  const user = await requireUser();
  if (user.totpEnabledAt) return {};
  if (!(await hit(`totp:setup:${user.id}`, 10, 3600)).ok) return { error: "Too many attempts. Try again later." };
  if (!(await reauthenticated(user, form))) {
    return { error: user.passwordHash ? "Enter your current password to continue." : "Please sign in again, then retry within 10 minutes." };
  }
  await getDb().update(schema.users).set({ totpSecret: encrypt(generateTotpSecret()), totpLastStep: null }).where(eq(schema.users.id, user.id));
  revalidatePath("/dashboard/account");
  return {};
}

export async function confirmTotp(_prev: unknown, form: FormData): Promise<TotpState> {
  const user = await requireUser();
  if (!user.totpSecret || user.totpEnabledAt) return { error: "Start the setup again." };
  if (!(await hit(`totp:confirm:${user.id}`, 10, 900)).ok) return { error: "Too many attempts. Try again later." };
  const step = verifyTotp(decrypt(user.totpSecret), str(form, "code"), null);
  if (step == null) return { error: "That code is not valid. Check the time on your phone and try again." };
  const { codes, hashes } = generateRecoveryCodes();
  // Turning 2FA on signs out every other session (none of them passed a second factor);
  // this browser just proved a code, so it gets a fresh 2FA session.
  const version = await bumpSessionVersion(user.id, { totpEnabledAt: new Date(), totpLastStep: step, totpRecoveryCodes: hashes });
  await createSession(user.id, version, { mfa: true });
  await auditSelf(user, "2fa.enable");
  return { message: "Two-factor authentication is on.", recoveryCodes: codes };
}

export async function disableTotp(_prev: unknown, form: FormData): Promise<TotpState> {
  const user = await requireUser();
  if (!user.totpSecret || !user.totpEnabledAt) return { error: "Two-factor authentication is not enabled." };
  if (!(await hit(`totp:disable:${user.id}`, 5, 900)).ok) return { error: "Too many attempts. Try again later." };
  const step = verifyTotp(decrypt(user.totpSecret), str(form, "code"), user.totpLastStep);
  if (step == null) return { error: "That code is not valid." };
  const version = await bumpSessionVersion(user.id, { totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryCodes: null });
  await createSession(user.id, version);
  await auditSelf(user, "2fa.disable");
  revalidatePath("/dashboard/account");
  return { message: "Two-factor authentication is off." };
}

export async function regenerateRecoveryCodes(_prev: unknown, form: FormData): Promise<TotpState> {
  const user = await requireUser();
  if (!user.totpSecret || !user.totpEnabledAt) return { error: "Two-factor authentication is not enabled." };
  if (!(await hit(`totp:regen:${user.id}`, 5, 900)).ok) return { error: "Too many attempts. Try again later." };
  const step = verifyTotp(decrypt(user.totpSecret), str(form, "code"), user.totpLastStep);
  if (step == null) return { error: "That code is not valid." };
  const { codes, hashes } = generateRecoveryCodes();
  await getDb().update(schema.users).set({ totpRecoveryCodes: hashes, totpLastStep: step }).where(eq(schema.users.id, user.id));
  await auditSelf(user, "2fa.recovery_codes");
  revalidatePath("/dashboard/account");
  return { message: "New recovery codes generated. The old ones no longer work.", recoveryCodes: codes };
}

// ---------- notifications ----------

export async function saveLowBalanceAlert(form: FormData) {
  const user = await requireUser();
  const raw = str(form, "threshold");
  const threshold = raw === "" ? null : usdToMicros(Math.max(0, Number(raw) || 0));
  await getDb().update(schema.users).set({ lowBalanceThreshold: threshold, lowBalanceNotifiedAt: null }).where(eq(schema.users.id, user.id));
  revalidatePath("/dashboard/account");
}

// ---------- redeem codes ----------

export async function redeem(_prev: unknown, form: FormData): Promise<{ error?: string; message?: string }> {
  const user = await requireUser();
  if (!(await hit(`redeem:user:${user.id}`, 10, 3600)).ok) return { error: "Too many attempts. Try again later." };
  const result = await redeemCode(user.id, str(form, "code"));
  if (!result.ok) return { error: result.error };
  revalidatePath("/dashboard/billing");
  return { message: `${formatUsd(result.amount)} added to your balance.` };
}
