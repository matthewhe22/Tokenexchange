"use server";

import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { PROVIDERS, SOURCES, type ModelCost, type Provider, type Source } from "@/db/schema";
import { invalidate } from "@/lib/cache";
import { testChannel } from "@/lib/channel-test";
import { invalidateChannels } from "@/lib/channels";
import { decrypt, encrypt, generateApiKey, sha256 } from "@/lib/crypto";
import { usdToMicros } from "@/lib/money";
import { audit } from "@/lib/audit";
import { invalidateGroups } from "@/lib/groups";
import { requireAdmin } from "@/lib/session";
import { generateRedeemCodes } from "@/lib/redeem";
import { saveLimitSettings, saveRoutingSettings, saveSecuritySettings } from "@/lib/settings";
import { PROVIDER_INFO } from "@/relay/providers/info";
import { rearmLowBalanceSql } from "@/lib/notifications";
import { zonedMidnight } from "@/lib/time";
import { fetchCatalog, suggestPublicName } from "@/lib/upstream-catalog";

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

function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.username || u.password) u.username = u.password = "***";
    for (const k of [...u.searchParams.keys()]) u.searchParams.set(k, "***");
    return u.toString();
  } catch {
    return "(unparseable URL)";
  }
}

/** "model=input/output[/cached]" lines (USD per 1M tokens) to a channel's per-model costs. */
function parseModelCosts(raw: string): Record<string, ModelCost> {
  const out: Record<string, ModelCost> = {};
  for (const line of raw.split("\n")) {
    const [model, prices] = line.split("=").map((s) => s?.trim());
    if (!model || !prices) continue;
    const [input, output, cacheRead] = prices.split("/").map((p) => Number(p.trim()));
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) continue;
    out[model] = Number.isFinite(cacheRead) && cacheRead >= 0 ? { input, output, cacheRead } : { input, output };
  }
  return out;
}

function parseLocalDate(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? zonedMidnight(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

// ---------- channels ----------

export async function saveChannel(form: FormData) {
  const admin = await requireAdmin();
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
    modelCosts: parseModelCosts(str(form, "modelCosts")),
    fixedCostHourly: str(form, "fixedCostHourly") === "" ? null : Math.max(0, num(form, "fixedCostHourly", 0)),
    capacityTpm: str(form, "capacityTpm") === "" ? null : Math.max(1, Math.floor(num(form, "capacityTpm", 1))),
    // Entered as a Melbourne (app time zone) calendar date: the commitment ends at local midnight.
    commitmentEndsAt: parseLocalDate(str(form, "commitmentEndsAt")),
    enabled: form.get("enabled") === "on",
    // Saving a channel is an explicit admin decision: take it out of automatic recovery.
    autoDisabledAt: null,
  };
  let channelId = id;
  if (id) await db.update(schema.channels).set(values).where(eq(schema.channels.id, id));
  else [{ id: channelId }] = await db.insert(schema.channels).values(values).returning({ id: schema.channels.id });
  const { credentials: _secret, ...logged } = values;
  // Relay URLs sometimes embed a key (?key=… or user:pass@); never write that to the audit log.
  if (logged.baseUrl) logged.baseUrl = redactUrl(logged.baseUrl);
  await audit(admin, id ? "channel.update" : "channel.create", `channel:${channelId}`, {
    ...logged,
    credentialFields: Object.keys(credentials),
    credentialsChanged: info.credentialFields.filter((k) => str(form, `cred.${k}`)),
  });
  invalidateChannels();
  revalidatePath("/admin/channels");
  redirect("/admin/channels");
}

export async function toggleChannel(form: FormData) {
  const admin = await requireAdmin();
  await getDb()
    .update(schema.channels)
    // A manual toggle takes the channel out of automatic recovery.
    .set({ enabled: sql`not ${schema.channels.enabled}`, autoDisabledAt: null, failCount: 0 })
    .where(eq(schema.channels.id, num(form, "id", 0)));
  await audit(admin, "channel.toggle", `channel:${num(form, "id", 0)}`);
  invalidateChannels();
  revalidatePath("/admin/channels");
}

export async function deleteChannel(form: FormData) {
  const admin = await requireAdmin();
  await getDb().delete(schema.channels).where(eq(schema.channels.id, num(form, "id", 0)));
  await audit(admin, "channel.delete", `channel:${num(form, "id", 0)}`);
  invalidateChannels();
  redirect("/admin/channels");
}

export async function runChannelTest(_prev: unknown, form: FormData) {
  const admin = await requireAdmin();
  const id = num(form, "id", 0);
  const [row] = await getDb().select().from(schema.channels).where(eq(schema.channels.id, id));
  if (!row) return { ok: false, status: 0, latencyMs: 0, message: "channel not found" };
  const ch = { ...row, credentials: JSON.parse(decrypt(row.credentials)) as Record<string, string> };
  return testChannel(ch, str(form, "model") || row.models[0] || "");
}

// ---------- prices ----------

export async function savePrice(form: FormData) {
  const admin = await requireAdmin();
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
    tierThreshold: str(form, "tierThreshold") ? Math.max(1, Math.floor(num(form, "tierThreshold", 0))) : null,
    tierInputPrice: opt("tierInputPrice"),
    tierOutputPrice: opt("tierOutputPrice"),
    perRequestPrice: opt("perRequestPrice"),
    flexMarkup: opt("flexMarkup"),
    batchMarkup: opt("batchMarkup"),
    priorityMultiplier: opt("priorityMultiplier"),
    benchmarkId: str(form, "benchmarkId") || null,
    enabled: form.get("enabled") === "on",
    updatedAt: new Date(),
  };
  await getDb().insert(schema.modelPrices).values(values).onConflictDoUpdate({ target: schema.modelPrices.model, set: values });
  await audit(admin, "price.save", `model:${model}`, values);
  invalidate("prices");
  revalidatePath("/admin/models");
}

export async function deletePrice(form: FormData) {
  const admin = await requireAdmin();
  await getDb().delete(schema.modelPrices).where(eq(schema.modelPrices.model, str(form, "model")));
  await audit(admin, "price.delete", `model:${str(form, "model")}`);
  invalidate("prices");
  revalidatePath("/admin/models");
}

// ---------- routing ----------

export async function saveRouting(form: FormData) {
  const admin = await requireAdmin();
  const enabledSources = SOURCES.filter((s) => form.get(`source.${s}`) === "on");
  const modelSources: Record<string, Source[]> = {};
  for (const line of str(form, "modelSources").split("\n")) {
    const [model, srcs] = line.split(":").map((s) => s?.trim());
    if (!model || !srcs) continue;
    const parsed = list(srcs).filter((s): s is Source => SOURCES.includes(s as Source));
    if (parsed.length) modelSources[model] = parsed;
  }
  const routing = {
    enabledSources,
    modelSources,
    maxAttempts: Math.min(10, Math.max(1, num(form, "maxAttempts", 3))),
    autoDisableAfter: Math.max(0, Math.floor(num(form, "autoDisableAfter", 0))),
    affinity: form.get("affinity") === "on",
    allowConversion: form.get("allowConversion") === "on",
  };
  await saveRoutingSettings(routing);
  await audit(admin, "settings.routing", null, routing);
  revalidatePath("/admin/settings");
}

export async function saveLimits(form: FormData) {
  const admin = await requireAdmin();
  const limits = {
    defaultKeyRpm: Math.max(0, Math.floor(num(form, "defaultKeyRpm", 0))),
    userRpm: Math.max(0, Math.floor(num(form, "userRpm", 0))),
  };
  await saveLimitSettings(limits);
  await audit(admin, "settings.limits", null, limits);
  revalidatePath("/admin/settings");
}

export async function saveSecurity(form: FormData) {
  const admin = await requireAdmin();
  const security = {
    requireAdmin2fa: form.get("requireAdmin2fa") === "on",
    lowBalanceDefault: usdToMicros(Math.max(0, num(form, "lowBalanceDefault", 0))),
  };
  // Never lock the current admin out: they must have 2FA before requiring it.
  if (security.requireAdmin2fa && !admin.totpEnabledAt) redirect("/dashboard/account?require2fa=1");
  await saveSecuritySettings(security);
  await audit(admin, "settings.security", null, security);
  revalidatePath("/admin/settings");
}

// ---------- users & keys ----------

export async function createUser(form: FormData) {
  const admin = await requireAdmin();
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
    await audit(admin, "user.create", `user:${user.id}`, { email, role, balance });
  });
  revalidatePath("/admin/users");
}

export async function adjustBalance(form: FormData) {
  const admin = await requireAdmin();
  const userId = num(form, "userId", 0);
  const amount = usdToMicros(num(form, "amount", 0));
  if (!amount) return;
  await getDb().transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ balance: sql`${schema.users.balance} + ${amount}`, lowBalanceNotifiedAt: await rearmLowBalanceSql(amount) })
      .where(eq(schema.users.id, userId));
    await tx.insert(schema.balanceTransactions).values({
      userId,
      amount,
      type: "adjust",
      note: `${str(form, "note") || "manual adjustment"} (by ${admin.email})`,
    });
  });
  await audit(admin, "user.adjust_balance", `user:${userId}`, { amount, note: str(form, "note") });
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
}

export async function toggleUser(form: FormData) {
  const admin = await requireAdmin();
  const userId = num(form, "userId", 0);
  await getDb().update(schema.users).set({ disabled: sql`not ${schema.users.disabled}` }).where(eq(schema.users.id, userId));
  await audit(admin, "user.toggle", `user:${userId}`);
  revalidatePath(`/admin/users/${userId}`);
}

export async function createKey(_prev: unknown, form: FormData): Promise<{ key?: string; error?: string }> {
  const admin = await requireAdmin();
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
  await audit(admin, "key.create", `user:${userId}`, { prefix: key.slice(0, 12), quota, models, rpm });
  revalidatePath(`/admin/users/${userId}`);
  return { key };
}

export async function toggleKey(form: FormData) {
  const admin = await requireAdmin();
  const [row] = await getDb()
    .update(schema.apiKeys)
    .set({ enabled: sql`not ${schema.apiKeys.enabled}` })
    .where(eq(schema.apiKeys.id, num(form, "id", 0)))
    .returning();
  if (row) await audit(admin, "key.toggle", `key:${row.id}`, { enabled: row.enabled });
  if (row) revalidatePath(`/admin/users/${row.userId}`);
}

export async function deleteKey(form: FormData) {
  const admin = await requireAdmin();
  const [row] = await getDb().delete(schema.apiKeys).where(eq(schema.apiKeys.id, num(form, "id", 0))).returning();
  if (row) await audit(admin, "key.delete", `key:${row.id}`, { prefix: row.keyPrefix });
  if (row) revalidatePath(`/admin/users/${row.userId}`);
}

// ---------- pricing groups ----------

export async function saveGroup(form: FormData) {
  const admin = await requireAdmin();
  const id = num(form, "id", 0);
  const values = {
    name: str(form, "name"),
    multiplier: Math.max(0, num(form, "multiplier", 1)),
    description: str(form, "description") || null,
  };
  if (!values.name) throw new Error("name is required");
  if (id) await getDb().update(schema.pricingGroups).set(values).where(eq(schema.pricingGroups.id, id));
  else await getDb().insert(schema.pricingGroups).values(values);
  await audit(admin, id ? "group.update" : "group.create", id ? `group:${id}` : null, values);
  invalidateGroups();
  revalidatePath("/admin/groups");
}

export async function deleteGroup(form: FormData) {
  const admin = await requireAdmin();
  await getDb().delete(schema.pricingGroups).where(eq(schema.pricingGroups.id, num(form, "id", 0)));
  await audit(admin, "group.delete", `group:${num(form, "id", 0)}`);
  invalidateGroups();
  revalidatePath("/admin/groups");
}

export async function setUserGroup(form: FormData) {
  const admin = await requireAdmin();
  const userId = num(form, "userId", 0);
  const groupId = num(form, "groupId", 0) || null;
  await getDb().update(schema.users).set({ groupId }).where(eq(schema.users.id, userId));
  await audit(admin, "user.set_group", `user:${userId}`, { groupId });
  revalidatePath(`/admin/users/${userId}`);
}

// ---------- redeem codes ----------

export async function createRedeemCodes(_prev: unknown, form: FormData): Promise<{ codes?: string[]; error?: string }> {
  const admin = await requireAdmin();
  const count = Math.floor(num(form, "count", 0));
  const amount = usdToMicros(num(form, "amount", 0));
  if (count < 1 || count > 500) return { error: "Generate between 1 and 500 codes at a time." };
  if (amount <= 0) return { error: "Amount must be positive." };
  const expires = str(form, "expiresAt");
  const batch = str(form, "batch") || null;
  const maxUses = Math.max(1, Math.floor(num(form, "maxUses", 1)));
  const codes = await generateRedeemCodes({ count, amount, maxUses, expiresAt: expires ? new Date(expires) : null, batch, createdBy: admin.id });
  await audit(admin, "redeem.generate", batch, { count, amount, maxUses, expires });
  revalidatePath("/admin/codes");
  return { codes };
}

// ---------- upstream catalogs (DeepInfra, Novita) ----------

async function loadChannelForCatalog(id: number) {
  const [row] = await getDb().select().from(schema.channels).where(eq(schema.channels.id, id));
  if (!row) throw new Error("channel not found");
  return { ...row, credentials: JSON.parse(decrypt(row.credentials)) as Record<string, string> };
}

/**
 * Adds the picked catalog models to the channel (mapping and per-model cost) and creates a price
 * row for each public name that has none, at the upstream's price as list, times `markup`.
 * Prices come from a fresh catalog fetch, never from the form.
 */
export async function importCatalogModels(form: FormData) {
  const admin = await requireAdmin();
  const id = num(form, "id", 0);
  const ch = await loadChannelForCatalog(id);
  const catalog = new Map((await fetchCatalog(ch)).map((m) => [m.id, m]));
  const markup = Math.max(0, num(form, "markup", 1.2));
  const batchMarkup = str(form, "batchMarkup") === "" ? null : Math.max(0, num(form, "batchMarkup", 0));

  const models = new Set(ch.models);
  const modelMapping = { ...ch.modelMapping };
  const modelCosts = { ...ch.modelCosts };
  const added: string[] = [];
  const db = getDb();
  for (const upstreamId of form.getAll("pick").map(String)) {
    const m = catalog.get(upstreamId);
    if (!m) continue;
    const pub = str(form, `name:${upstreamId}`) || suggestPublicName(upstreamId);
    models.add(pub);
    if (pub !== upstreamId) modelMapping[pub] = upstreamId;
    else delete modelMapping[pub];
    modelCosts[pub] = m.cost;
    added.push(pub);
    await db
      .insert(schema.modelPrices)
      .values({
        model: pub,
        inputPrice: m.cost.input,
        outputPrice: m.cost.output,
        cacheReadPrice: m.cost.cacheRead ?? null,
        markup,
        batchMarkup,
      })
      .onConflictDoNothing();
  }
  await db.update(schema.channels).set({ models: [...models], modelMapping, modelCosts }).where(eq(schema.channels.id, id));
  await audit(admin, "channel.catalog_import", `channel:${id}`, { added, markup, batchMarkup });
  invalidateChannels();
  invalidate("prices");
  revalidatePath(`/admin/channels/${id}`);
  redirect(`/admin/channels/${id}?imported=${added.length}`);
}

export interface CostRefreshResult {
  ok: boolean;
  message: string;
  changes: { model: string; before: ModelCost | null; after: ModelCost }[];
  missing: string[];
}

/** Re-reads the channel's catalog and updates the per-model costs of the models it serves. */
export async function refreshCatalogCosts(_prev: unknown, form: FormData): Promise<CostRefreshResult> {
  const admin = await requireAdmin();
  const id = num(form, "id", 0);
  try {
    const ch = await loadChannelForCatalog(id);
    const catalog = new Map((await fetchCatalog(ch)).map((m) => [m.id, m]));
    const modelCosts = { ...ch.modelCosts };
    const changes: CostRefreshResult["changes"] = [];
    const missing: string[] = [];
    for (const pub of ch.models) {
      const m = catalog.get(ch.modelMapping[pub] ?? pub);
      if (!m) {
        missing.push(pub);
        continue;
      }
      const before = ch.modelCosts[pub] ?? null;
      if (JSON.stringify(before) !== JSON.stringify(m.cost)) changes.push({ model: pub, before, after: m.cost });
      modelCosts[pub] = m.cost;
    }
    await getDb().update(schema.channels).set({ modelCosts }).where(eq(schema.channels.id, id));
    if (changes.length) await audit(admin, "channel.costs_refresh", `channel:${id}`, { changes });
    invalidateChannels();
    revalidatePath(`/admin/channels/${id}`);
    return { ok: true, message: `${changes.length} cost change(s)`, changes, missing };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), changes: [], missing: [] };
  }
}
