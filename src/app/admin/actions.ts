"use server";

import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { PROVIDERS, SOURCES, type Provider, type Source } from "@/db/schema";
import { invalidate } from "@/lib/cache";
import { testChannel } from "@/lib/channel-test";
import { invalidateChannels } from "@/lib/channels";
import { decrypt, encrypt, generateApiKey, sha256 } from "@/lib/crypto";
import { usdToMicros } from "@/lib/money";
import { requireAdmin } from "@/lib/session";
import { saveLimitSettings, saveRoutingSettings } from "@/lib/settings";
import { PROVIDER_INFO } from "@/relay/providers/info";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string, d: number) => {
  const v = str(f, k);
  const n = Number(v);
  return v === "" || !Number.isFinite(n) ? d : n;
};
const list = (v: string) =>
  v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

// ---------- channels ----------

export async function saveChannel(form: FormData) {
  await requireAdmin();
  const id = num(form, "id", 0);
  const provider = str(form, "provider") as Provider;
  if (!PROVIDERS.includes(provider)) throw new Error("unknown provider");
  const sourceRaw = str(form, "source");
  const source: Source = SOURCES.includes(sourceRaw as Source) ? (sourceRaw as Source) : PROVIDER_INFO[provider].defaultSource;
  const info = PROVIDER_INFO[provider];

  const config: Record<string, string> = {};
  for (const k of info.configFields) if (str(form, `config.${k}`)) config[k] = str(form, `config.${k}`);

  const modelMapping: Record<string, string> = {};
  for (const line of str(form, "modelMapping").split("\n")) {
    const [from, to] = line.split("=").map((s) => s?.trim());
    if (from && to) modelMapping[from] = to;
  }

  const db = getDb();
  // Blank credential inputs on edit keep the stored value.
  let existing: Record<string, string> = {};
  if (id) {
    const [row] = await db.select().from(schema.channels).where(eq(schema.channels.id, id));
    if (row) existing = JSON.parse(decrypt(row.credentials));
  }
  const credentials: Record<string, string> = {};
  for (const k of info.credentialFields) {
    const v = str(form, `cred.${k}`) || existing[k];
    if (v) credentials[k] = v;
  }

  const values = {
    name: str(form, "name") || info.label,
    provider,
    source,
    baseUrl: str(form, "baseUrl") || null,
    config,
    credentials: encrypt(JSON.stringify(credentials)),
    models: list(str(form, "models")),
    modelMapping,
    priority: num(form, "priority", 0),
    weight: Math.max(1, num(form, "weight", 1)),
    costMultiplier: num(form, "costMultiplier", 1),
    enabled: form.get("enabled") === "on",
  };
  if (id) await db.update(schema.channels).set(values).where(eq(schema.channels.id, id));
  else await db.insert(schema.channels).values(values);
  invalidateChannels();
  revalidatePath("/admin/channels");
  redirect("/admin/channels");
}

export async function toggleChannel(form: FormData) {
  await requireAdmin();
  await getDb()
    .update(schema.channels)
    .set({ enabled: sql`not ${schema.channels.enabled}` })
    .where(eq(schema.channels.id, num(form, "id", 0)));
  invalidateChannels();
  revalidatePath("/admin/channels");
}

export async function deleteChannel(form: FormData) {
  await requireAdmin();
  await getDb().delete(schema.channels).where(eq(schema.channels.id, num(form, "id", 0)));
  invalidateChannels();
  redirect("/admin/channels");
}

export async function runChannelTest(_prev: unknown, form: FormData) {
  await requireAdmin();
  const id = num(form, "id", 0);
  const [row] = await getDb().select().from(schema.channels).where(eq(schema.channels.id, id));
  if (!row) return { ok: false, status: 0, latencyMs: 0, message: "channel not found" };
  const ch = { ...row, credentials: JSON.parse(decrypt(row.credentials)) as Record<string, string> };
  return testChannel(ch, str(form, "model") || row.models[0] || "");
}

// ---------- prices ----------

export async function savePrice(form: FormData) {
  await requireAdmin();
  const model = str(form, "model");
  if (!model) throw new Error("model is required");
  const opt = (k: string) => (str(form, k) === "" ? null : num(form, k, 0));
  const values = {
    model,
    inputPrice: num(form, "inputPrice", 0),
    outputPrice: num(form, "outputPrice", 0),
    cacheReadPrice: opt("cacheReadPrice"),
    cacheWritePrice: opt("cacheWritePrice"),
    markup: num(form, "markup", 1),
    maxOutputTokens: str(form, "maxOutputTokens") ? Math.max(1, Math.floor(num(form, "maxOutputTokens", 0))) : null,
    enabled: form.get("enabled") === "on",
    updatedAt: new Date(),
  };
  await getDb().insert(schema.modelPrices).values(values).onConflictDoUpdate({ target: schema.modelPrices.model, set: values });
  invalidate("prices");
  revalidatePath("/admin/models");
}

export async function deletePrice(form: FormData) {
  await requireAdmin();
  await getDb().delete(schema.modelPrices).where(eq(schema.modelPrices.model, str(form, "model")));
  invalidate("prices");
  revalidatePath("/admin/models");
}

// ---------- routing ----------

export async function saveRouting(form: FormData) {
  await requireAdmin();
  const enabledSources = SOURCES.filter((s) => form.get(`source.${s}`) === "on");
  const modelSources: Record<string, Source[]> = {};
  for (const line of str(form, "modelSources").split("\n")) {
    const [model, srcs] = line.split(":").map((s) => s?.trim());
    if (!model || !srcs) continue;
    const parsed = list(srcs).filter((s): s is Source => SOURCES.includes(s as Source));
    if (parsed.length) modelSources[model] = parsed;
  }
  await saveRoutingSettings({
    enabledSources,
    modelSources,
    maxAttempts: Math.min(10, Math.max(1, num(form, "maxAttempts", 3))),
    autoDisableAfter: Math.max(0, Math.floor(num(form, "autoDisableAfter", 0))),
    affinity: form.get("affinity") === "on",
    allowConversion: form.get("allowConversion") === "on",
  });
  revalidatePath("/admin/settings");
}

export async function saveLimits(form: FormData) {
  await requireAdmin();
  await saveLimitSettings({
    defaultKeyRpm: Math.max(0, Math.floor(num(form, "defaultKeyRpm", 0))),
    userRpm: Math.max(0, Math.floor(num(form, "userRpm", 0))),
  });
  revalidatePath("/admin/settings");
}

// ---------- users & keys ----------

export async function createUser(form: FormData) {
  await requireAdmin();
  const email = str(form, "email").toLowerCase();
  if (!email.includes("@")) throw new Error("valid email required");
  const password = str(form, "password");
  const role = str(form, "role") === "admin" ? "admin" : "user";
  const balance = usdToMicros(num(form, "balance", 0));
  const db = getDb();
  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({ email, role, balance, passwordHash: password ? await bcrypt.hash(password, 10) : null, emailVerifiedAt: new Date() })
      .returning();
    if (balance) await tx.insert(schema.balanceTransactions).values({ userId: user.id, amount: balance, type: "adjust", note: "initial balance" });
  });
  revalidatePath("/admin/users");
}

export async function adjustBalance(form: FormData) {
  const admin = await requireAdmin();
  const userId = num(form, "userId", 0);
  const amount = usdToMicros(num(form, "amount", 0));
  if (!amount) return;
  await getDb().transaction(async (tx) => {
    await tx.update(schema.users).set({ balance: sql`${schema.users.balance} + ${amount}` }).where(eq(schema.users.id, userId));
    await tx.insert(schema.balanceTransactions).values({
      userId,
      amount,
      type: "adjust",
      note: `${str(form, "note") || "manual adjustment"} (by ${admin.email})`,
    });
  });
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
}

export async function toggleUser(form: FormData) {
  await requireAdmin();
  const userId = num(form, "userId", 0);
  await getDb().update(schema.users).set({ disabled: sql`not ${schema.users.disabled}` }).where(eq(schema.users.id, userId));
  revalidatePath(`/admin/users/${userId}`);
}

export async function createKey(_prev: unknown, form: FormData): Promise<{ key?: string; error?: string }> {
  await requireAdmin();
  const userId = num(form, "userId", 0);
  const key = generateApiKey();
  const quota = str(form, "quota");
  const models = list(str(form, "allowedModels"));
  const expires = str(form, "expiresAt");
  const rpm = str(form, "rpmLimit");
  await getDb()
    .insert(schema.apiKeys)
    .values({
      userId,
      name: str(form, "name") || "default",
      keyHash: sha256(key),
      keyPrefix: key.slice(0, 12),
      quotaLimit: quota ? usdToMicros(Number(quota)) : null,
      allowedModels: models.length ? models : null,
      expiresAt: expires ? new Date(expires) : null,
      rpmLimit: rpm ? Math.max(0, Math.floor(Number(rpm))) : null,
    });
  revalidatePath(`/admin/users/${userId}`);
  return { key };
}

export async function toggleKey(form: FormData) {
  await requireAdmin();
  const [row] = await getDb()
    .update(schema.apiKeys)
    .set({ enabled: sql`not ${schema.apiKeys.enabled}` })
    .where(eq(schema.apiKeys.id, num(form, "id", 0)))
    .returning();
  if (row) revalidatePath(`/admin/users/${row.userId}`);
}

export async function deleteKey(form: FormData) {
  await requireAdmin();
  const [row] = await getDb().delete(schema.apiKeys).where(eq(schema.apiKeys.id, num(form, "id", 0))).returning();
  if (row) revalidatePath(`/admin/users/${row.userId}`);
}
