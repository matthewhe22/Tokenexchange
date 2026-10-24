// End-to-end check of the gateway against mock upstreams.
// Usage: start the app (`npm run build && npm start`), then `npx tsx scripts/e2e.ts`.
// WARNING: truncates all tables in DATABASE_URL.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import Stripe from "stripe";
import * as schema from "../src/db/schema";
import { encrypt, generateApiKey, sha256 } from "../src/lib/crypto";
import { startMockUpstream } from "./mock-upstream";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const MOCK_PORT = 4010;
const MOCK = `http://localhost:${MOCK_PORT}`;

const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema });
const mock = await startMockUpstream(MOCK_PORT);

await db.execute(sql`truncate usage_logs, balance_transactions, api_keys, channels, model_prices, settings, users restart identity cascade`);

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const serviceAccount = JSON.stringify({
  type: "service_account",
  client_email: "relay@proj-1.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  project_id: "proj-1",
  token_uri: `${MOCK}/google/token`,
});

await db.insert(schema.modelPrices).values([
  { model: "gpt-test", inputPrice: 2, outputPrice: 8, cacheReadPrice: 1 },
  { model: "embed-test", inputPrice: 0.1, outputPrice: 0 },
  { model: "claude-test", inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3, markup: 1.1 },
  { model: "claude-vertex", inputPrice: 3, outputPrice: 15 },
  { model: "gemini-test", inputPrice: 1, outputPrice: 4 },
  { model: "azure-test", inputPrice: 1, outputPrice: 1 },
  { model: "orphan-test", inputPrice: 1, outputPrice: 1 },
  { model: "slow-test", inputPrice: 1, outputPrice: 1 },
  { model: "reset-test", inputPrice: 1, outputPrice: 1 },
]);

type NewChannel = typeof schema.channels.$inferInsert;
const channel = (c: Omit<NewChannel, "credentials"> & { credentials: Record<string, string> }): NewChannel => ({
  ...c,
  credentials: encrypt(JSON.stringify(c.credentials)),
});
await db.insert(schema.channels).values([
  // highest priority but broken: requests must fail over to the next channel
  channel({ name: "broken reseller", provider: "openai_compatible", source: "reseller", baseUrl: `${MOCK}/broken/v1`, credentials: { apiKey: "x" }, models: ["gpt-test"], priority: 10 }),
  channel({ name: "openai official", provider: "openai", source: "official", baseUrl: `${MOCK}/openai/v1`, credentials: { apiKey: "up-openai" }, models: ["gpt-test", "embed-test"], modelMapping: { "gpt-test": "gpt-upstream" }, costMultiplier: 0.9 }),
  channel({ name: "azure", provider: "azure_openai", source: "cloud", baseUrl: `${MOCK}/azure/openai/v1`, credentials: { apiKey: "up-azure" }, models: ["azure-test"] }),
  channel({ name: "anthropic relay", provider: "anthropic_compatible", source: "reseller", baseUrl: `${MOCK}/anthropic`, credentials: { apiKey: "up-anthropic" }, models: ["claude-test"], priority: 5 }),
  channel({ name: "bedrock", provider: "bedrock", source: "cloud", baseUrl: `${MOCK}/bedrock`, config: { region: "us-east-1" }, credentials: { apiKey: "up-bedrock" }, models: ["claude-test"], modelMapping: { "claude-test": "us.anthropic.claude-test-v1:0" } }),
  channel({ name: "vertex", provider: "vertex", source: "cloud", baseUrl: `${MOCK}/vertex`, config: { location: "global" }, credentials: { serviceAccount }, models: ["claude-vertex", "gemini-test"] }),
  channel({ name: "reset", provider: "openai_compatible", source: "reseller", baseUrl: `${MOCK}/reset/v1`, credentials: { apiKey: "x" }, models: ["reset-test"] }),
  channel({ name: "slow", provider: "openai_compatible", source: "reseller", baseUrl: `${MOCK}/slow/v1`, credentials: { apiKey: "x" }, models: ["slow-test"] }),
  channel({ name: "gemini official", provider: "gemini", source: "official", baseUrl: `${MOCK}/gemini`, credentials: { apiKey: "up-gemini" }, models: ["gemini-test"], priority: 5 }),
]);

const [user] = await db.insert(schema.users).values({ email: "buyer@example.com", balance: 1_000_000 }).returning();
const key = generateApiKey();
await db.insert(schema.apiKeys).values({ userId: user.id, name: "e2e", keyHash: sha256(key), keyPrefix: key.slice(0, 12) });

const post = (path: string, body: unknown, headers: Record<string, string> = { authorization: `Bearer ${key}` }) =>
  fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function logsSettled(count: number) {
  for (let i = 0; i < 50; i++) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.usageLogs);
    if (n >= count) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`expected ${count} usage logs`);
}
const lastLog = async () => (await db.select().from(schema.usageLogs).orderBy(sql`id desc`).limit(1))[0];
const settings = (value: unknown) =>
  db.insert(schema.settings).values({ key: "routing", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });

let logs = 0;
const step = async (name: string, fn: () => Promise<void>) => {
  await fn();
  console.log(`✓ ${name}`);
};

await step("OpenAI chat, fails over from broken reseller, maps model, bills cached tokens", async () => {
  const res = await post("/v1/chat/completions", { model: "gpt-test", messages: [{ role: "user", content: "hi" }] });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await res.json()).choices[0].message.content, "pong");
  await logsSettled(++logs);
  const log = await lastLog();
  assert.equal(log.upstreamModel, "gpt-upstream");
  assert.deepEqual([log.inputTokens, log.outputTokens, log.cacheReadTokens], [16, 5, 4]);
  assert.equal(log.cost, 16 * 2 + 5 * 8 + 4 * 1);
  assert.equal(log.upstreamCost, Math.round((16 * 2 + 5 * 8 + 4 * 1) * 0.9));
  const [broken] = await db.select().from(schema.channels).where(eq(schema.channels.name, "broken reseller"));
  assert.ok(broken.failCount >= 1);
});

await step("OpenAI chat stream gets include_usage injected and is billed", async () => {
  const res = await post("/v1/chat/completions", { model: "gpt-test", stream: true, messages: [] });
  const text = await res.text();
  assert.match(text, /"content":"po"/);
  assert.match(text, /\[DONE\]/);
  await logsSettled(++logs);
  const log = await lastLog();
  assert.equal(log.stream, true);
  assert.deepEqual([log.inputTokens, log.outputTokens], [20, 5]);
});

await step("Responses API stream", async () => {
  const text = await (await post("/v1/responses", { model: "gpt-test", stream: true, input: "hi" })).text();
  assert.match(text, /response.completed/);
  await logsSettled(++logs);
  assert.deepEqual([(await lastLog()).inputTokens, (await lastLog()).outputTokens], [30, 6]);
});

await step("Embeddings", async () => {
  const res = await post("/v1/embeddings", { model: "embed-test", input: "hi" });
  assert.equal(res.status, 200);
  await logsSettled(++logs);
  assert.equal((await lastLog()).inputTokens, 8);
});

await step("Azure OpenAI uses api-key header", async () => {
  const res = await post("/v1/chat/completions", { model: "azure-test", messages: [] });
  assert.equal(res.status, 200, await res.clone().text());
  await logsSettled(++logs);
});

await step("Anthropic Messages stream via relay (x-api-key auth from client), markup applied", async () => {
  const res = await post("/v1/messages", { model: "claude-test", max_tokens: 10, stream: true, messages: [] }, { "x-api-key": key, "anthropic-version": "2023-06-01" });
  const text = await res.text();
  assert.match(text, /event: message_stop/);
  await logsSettled(++logs);
  const log = await lastLog();
  assert.deepEqual([log.inputTokens, log.outputTokens, log.cacheReadTokens], [11, 7, 5]);
  assert.equal(log.cost, Math.ceil((11 * 3 + 7 * 15 + 5 * 0.3) * 1.1));
});

await step("Upstream 400 is passed through and not retried", async () => {
  const res = await post("/v1/messages", { model: "claude-test", max_tokens: 5, bogus_param: true, messages: [] }, { "x-api-key": key });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /bogus_param/);
  await logsSettled(++logs);
});

await step("Disabling the reseller source routes Claude to Bedrock (event-stream converted to SSE)", async () => {
  await settings({ enabledSources: ["official", "cloud"], modelSources: {}, maxAttempts: 3 });
  await new Promise((r) => setTimeout(r, 10_500)); // settings cache TTL
  const res = await post("/v1/messages", { model: "claude-test", max_tokens: 10, stream: true, messages: [] }, { "x-api-key": key });
  const text = await res.text();
  assert.match(text, /event: content_block_delta\ndata: .*pong/);
  await logsSettled(++logs);
  const log = await lastLog();
  assert.equal(log.upstreamModel, "us.anthropic.claude-test-v1:0");
  assert.equal(log.outputTokens, 7);
  assert.ok(mock.received.some((r) => r.path === "/bedrock/model/us.anthropic.claude-test-v1%3A0/invoke-with-response-stream"));
});

await step("Vertex Claude (service-account token exchange)", async () => {
  const res = await post("/v1/messages", { model: "claude-vertex", max_tokens: 10, messages: [] }, { "x-api-key": key });
  assert.equal(res.status, 200, await res.clone().text());
  await logsSettled(++logs);
});

await step("Gemini stream via official API (?key= auth), thinking tokens billed", async () => {
  const res = await post(`/v1beta/models/gemini-test:streamGenerateContent?alt=sse&key=${key}`, { contents: [] }, {});
  const text = await res.text();
  assert.match(text, /usageMetadata/);
  await logsSettled(++logs);
  assert.equal((await lastLog()).outputTokens, 13);
});

await step("Per-model source restriction sends Gemini to Vertex", async () => {
  await settings({ enabledSources: ["official", "cloud"], modelSources: { "gemini-test": ["cloud"] }, maxAttempts: 3 });
  await new Promise((r) => setTimeout(r, 10_500));
  const res = await post("/v1beta/models/gemini-test:generateContent", { contents: [] }, { "x-goog-api-key": key });
  assert.equal(res.status, 200, await res.clone().text());
  await logsSettled(++logs);
  const [vertex] = await db.select().from(schema.channels).where(eq(schema.channels.name, "vertex"));
  assert.equal((await lastLog()).channelId, vertex.id);
});

await step("Errors: bad key, unpriced model, model with no channel, empty balance", async () => {
  assert.equal((await post("/v1/chat/completions", { model: "gpt-test" }, { authorization: "Bearer nope" })).status, 401);
  assert.equal((await post("/v1/chat/completions", { model: "unknown", messages: [] })).status, 404);
  assert.equal((await post("/v1/chat/completions", { model: "orphan-test", messages: [] })).status, 503);
  const anth = await post("/v1/messages", { model: "nope", max_tokens: 1, messages: [] }, { "x-api-key": key });
  assert.equal((await anth.json()).type, "error");
  await db.update(schema.users).set({ balance: 0 }).where(eq(schema.users.id, user.id));
  assert.equal((await post("/v1/chat/completions", { model: "gpt-test", messages: [] })).status, 402);
});

await step("Balance and key usage were debited by the sum of logged costs", async () => {
  await db.update(schema.users).set({ balance: 1_000_000 }).where(eq(schema.users.id, user.id));
  const res = await post("/v1/chat/completions", { model: "gpt-test", messages: [] });
  assert.equal(res.status, 200);
  await logsSettled(++logs);
  const [{ total }] = await db.select({ total: sql<number>`sum(cost)::int` }).from(schema.usageLogs).where(sql`id = (select max(id) from usage_logs)`);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  assert.equal(u.balance, 1_000_000 - total);
  const [k] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.userId, user.id));
  const [{ all }] = await db.select({ all: sql<number>`sum(cost)::int` }).from(schema.usageLogs);
  assert.equal(k.used, all);
});

await step("GET /v1/models lists priced models", async () => {
  const res = await fetch(`${BASE}/v1/models`, { headers: { authorization: `Bearer ${key}` } });
  const ids = (await res.json()).data.map((m: { id: string }) => m.id);
  assert.ok(ids.includes("gpt-test") && ids.includes("claude-test"));
});

// ---------- P0: reservations, rate limits ----------
const reservationsLeft = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(schema.reservations))[0].n;

await step("Every settled request released its reservation", async () => {
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await reservationsLeft(), 0);
});

await step("Concurrent requests cannot overdraw: the first holds the whole small balance, the rest get 402", async () => {
  await settings({ enabledSources: ["official", "cloud", "reseller"], modelSources: {}, maxAttempts: 3 });
  await new Promise((r) => setTimeout(r, 10_500));
  // estimate ≈ 4096 output tokens x $1/M = 4096 micro-USD > balance of 1000
  await db.update(schema.users).set({ balance: 1000 }).where(eq(schema.users.id, user.id));
  const results = await Promise.all(
    Array.from({ length: 5 }, () => post("/v1/chat/completions", { model: "slow-test", messages: [] }).then((r) => r.status)),
  );
  assert.equal(results.filter((s) => s === 200).length, 1, String(results));
  assert.equal(results.filter((s) => s === 402).length, 4, String(results));
  await logsSettled((logs += 1));
  await new Promise((r) => setTimeout(r, 300));
  // the hold could only cover ~985 output tokens, so the upstream request was capped to that
  const slowCall = mock.received.filter((r) => r.path === "/slow/v1/chat/completions").at(-1)!;
  assert.ok(slowCall.body.max_completion_tokens >= 256 && slowCall.body.max_completion_tokens < 1000, JSON.stringify(slowCall.body));
  // actual cost 20 + 5 = 25; the rest of the hold is returned
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  assert.equal(u.balance, 1000 - 25);
  assert.equal(await reservationsLeft(), 0);
});

await step("A balance too small for even a short answer is refused before calling upstream", async () => {
  await db.update(schema.users).set({ balance: 100 }).where(eq(schema.users.id, user.id));
  const before = mock.received.length;
  assert.equal((await post("/v1/chat/completions", { model: "slow-test", messages: [] })).status, 402);
  assert.equal(mock.received.length, before);
  assert.equal((await db.select().from(schema.users).where(eq(schema.users.id, user.id)))[0].balance, 100);
});

await step("If the upstream connection drops mid-body, the hold is released and the client gets a clean 502", async () => {
  await db.update(schema.users).set({ balance: 1_000_000 }).where(eq(schema.users.id, user.id));
  const res = await post("/v1/chat/completions", { model: "reset-test", messages: [] });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.message, "gateway error, please retry");
  assert.equal(await reservationsLeft(), 0);
  assert.equal((await db.select().from(schema.users).where(eq(schema.users.id, user.id)))[0].balance, 1_000_000);
});

await step("Stale reservations are released by the cron endpoint", async () => {
  await db.update(schema.users).set({ balance: 500 }).where(eq(schema.users.id, user.id));
  const [k] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.userId, user.id));
  await db.insert(schema.reservations).values({ userId: user.id, apiKeyId: k.id, amount: 300, createdAt: new Date(Date.now() - 60 * 60 * 1000) });
  await db.update(schema.users).set({ balance: 200 }).where(eq(schema.users.id, user.id));
  assert.equal((await fetch(`${BASE}/api/cron/release-reservations`)).status, 401);
  const res = await fetch(`${BASE}/api/cron/release-reservations`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  assert.deepEqual(await res.json(), { released: 1 });
  assert.equal((await db.select().from(schema.users).where(eq(schema.users.id, user.id)))[0].balance, 500);
});

await step("Per-key requests-per-minute limit returns 429 with Retry-After", async () => {
  await db.update(schema.users).set({ balance: 1_000_000 }).where(eq(schema.users.id, user.id));
  const limitedKey = generateApiKey();
  await db.insert(schema.apiKeys).values({ userId: user.id, name: "limited", keyHash: sha256(limitedKey), keyPrefix: limitedKey.slice(0, 12), rpmLimit: 2 });
  const auth = { authorization: `Bearer ${limitedKey}` };
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await post("/v1/chat/completions", { model: "gpt-test", messages: [] }, auth)).status);
  const blocked = await post("/v1/chat/completions", { model: "gpt-test", messages: [] }, auth);
  // 2 allowed; the 3rd and 4th are limited (unless the minute rolled over mid-test)
  assert.equal(statuses[0], 200);
  assert.ok(statuses.includes(429) || blocked.status === 429, String(statuses));
  if (blocked.status === 429) assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  logs = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.usageLogs))[0].n;
});

// ---------- Stripe webhooks ----------
const stripe = new Stripe("sk_test_e2e");
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_e2e";
let eventSeq = 0;
const sendEvent = (type: string, object: Record<string, unknown>, signature?: string) => {
  const payload = JSON.stringify({ id: `evt_${++eventSeq}`, object: "event", type, api_version: "2025-01-01", created: 0, data: { object } });
  const header = signature ?? stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  return fetch(`${BASE}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": header, "content-type": "application/json" }, body: payload });
};
const balanceOf = async () => (await db.select().from(schema.users).where(eq(schema.users.id, user.id)))[0].balance;
const paidSession = { id: "cs_e2e_1", object: "checkout.session", mode: "payment", payment_status: "paid", amount_subtotal: 2500, amount_total: 2500, currency: "usd", client_reference_id: String(user.id), metadata: { userId: String(user.id) } };

await step("Stripe webhook rejects bad signatures", async () => {
  const res = await sendEvent("checkout.session.completed", paidSession, "t=1,v1=deadbeef");
  assert.equal(res.status, 400);
});

await step("Paid checkout credits the balance exactly once", async () => {
  const before = await balanceOf();
  assert.equal((await sendEvent("checkout.session.completed", paidSession)).status, 200);
  assert.equal(await balanceOf(), before + 25_000_000);
  assert.equal((await sendEvent("checkout.session.completed", paidSession)).status, 200);
  assert.equal(await balanceOf(), before + 25_000_000);
  await sendEvent("checkout.session.completed", { ...paidSession, id: "cs_e2e_unpaid", payment_status: "unpaid" });
  assert.equal(await balanceOf(), before + 25_000_000);
});

await step("Refunds debit incrementally and idempotently", async () => {
  await db.update(schema.users).set({ stripeCustomerId: "cus_e2e" }).where(eq(schema.users.id, user.id));
  const before = await balanceOf();
  const charge = { id: "ch_e2e", object: "charge", customer: "cus_e2e", amount: 2500, amount_refunded: 1000 };
  await sendEvent("charge.refunded", charge);
  await sendEvent("charge.refunded", charge);
  assert.equal(await balanceOf(), before - 10_000_000);
  await sendEvent("charge.refunded", { ...charge, amount_refunded: 1500 });
  assert.equal(await balanceOf(), before - 15_000_000);
});

console.log("\nall e2e checks passed");
mock.close();
await client.end();
