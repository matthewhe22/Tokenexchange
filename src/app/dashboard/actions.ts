"use server";

import bcrypt from "bcryptjs";
import { and, count, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { decrypt, encrypt, generateApiKey, sha256 } from "@/lib/crypto";
import { generateTotpSecret, verifyTotp } from "@/lib/totp";
import { usdToMicros } from "@/lib/money";
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

export async function startTotpSetup() {
  const user = await requireUser();
  if (user.totpEnabledAt) return;
  await getDb().update(schema.users).set({ totpSecret: encrypt(generateTotpSecret()), totpLastStep: null }).where(eq(schema.users.id, user.id));
  revalidatePath("/dashboard/account");
}

export async function confirmTotp(_prev: unknown, form: FormData): Promise<{ error?: string; message?: string }> {
  const user = await requireUser();
  if (!user.totpSecret || user.totpEnabledAt) return { error: "Start the setup again." };
  const step = verifyTotp(decrypt(user.totpSecret), str(form, "code"), null);
  if (step == null) return { error: "That code is not valid. Check the time on your phone and try again." };
  await getDb().update(schema.users).set({ totpEnabledAt: new Date(), totpLastStep: step }).where(eq(schema.users.id, user.id));
  revalidatePath("/dashboard/account");
  return { message: "Two-factor authentication is on." };
}

export async function disableTotp(_prev: unknown, form: FormData): Promise<{ error?: string; message?: string }> {
  const user = await requireUser();
  if (!user.totpSecret || !user.totpEnabledAt) return { error: "Two-factor authentication is not enabled." };
  if (verifyTotp(decrypt(user.totpSecret), str(form, "code"), user.totpLastStep) == null) return { error: "That code is not valid." };
  await getDb().update(schema.users).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null }).where(eq(schema.users.id, user.id));
  revalidatePath("/dashboard/account");
  return { message: "Two-factor authentication is off." };
}

// ---------- notifications ----------

export async function saveLowBalanceAlert(form: FormData) {
  const user = await requireUser();
  const raw = str(form, "threshold");
  const threshold = raw === "" ? null : usdToMicros(Math.max(0, Number(raw) || 0));
  await getDb().update(schema.users).set({ lowBalanceThreshold: threshold, lowBalanceNotifiedAt: null }).where(eq(schema.users.id, user.id));
  revalidatePath("/dashboard/account");
}
