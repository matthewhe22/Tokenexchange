"use server";

import bcrypt from "bcryptjs";
import { and, count, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { generateApiKey, sha256 } from "@/lib/crypto";
import { usdToMicros } from "@/lib/money";
import { requireUser } from "@/lib/session";
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
  await getDb().update(schema.users).set({ passwordHash: await bcrypt.hash(next, 10) }).where(eq(schema.users.id, user.id));
  return { message: "Password updated." };
}
