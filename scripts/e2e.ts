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
import { DEFAULT_ROUTING } from "../src/lib/settings";
import { startMockUpstream } from "./mock-upstream";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const MOCK_PORT = 4010;
const MOCK = `http://localhost:${MOCK_PORT}`;

const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema });
const mock = await startMockUpstream(MOCK_PORT);

await db.execute(
  sql`truncate usage_logs, balance_transactions, api_keys, channels, model_prices, settings, users, pricing_groups, audit_logs, redeem_codes, rate_limits, reservations, auth_tokens, files, batches restart identity cascade`,
);

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
  { model: "flaky-test", inputPrice: 1, outputPrice: 1 },
  { model: "fault-test", inputPrice: 1, outputPrice: 1 },
  { model: "tier-test", inputPrice: 1, outputPrice: 1, tierThreshold: 10, tierInputPrice: 3, tierOutputPrice: 4 },
  { model: "dalle-test", inputPrice: 0, outputPrice: 0, perRequestPrice: 0.04 },
  { model: "tts-test", inputPrice: 15, outputPrice: 0 },
  { model: "whisper-test", inputPrice: 0, outputPrice: 0, perRequestPrice: 0.006 },
  { model: "rerank-test", inputPrice: 0.05, outputPrice: 0 },
  { model: "flex-test", inputPrice: 2, outputPrice: 8, flexMarkup: 0.8 },
  { model: "gpt-batch", inputPrice: 2, outputPrice: 8, batchMarkup: 0.8 },
  { model: "claude-batch", inputPrice: 3, outputPrice: 15, batchMarkup: 0.8 },
  { model: "claude-batch-big", inputPrice: 15, outputPrice: 75, batchMarkup: 0.8 },
  { model: "relay-batch", inputPrice: 2, outputPrice: 8, batchMarkup: 0.9 },
  { model: "oss-model", inputPrice: 1, outputPrice: 2, markup: 1.2, batchMarkup: 0.9 },
  { model: "ptu-test", inputPrice: 1, outputPrice: 1 },
  { model: "nomusage-test", inputPrice: 1, outputPrice: 1 },
]);

type NewChannel = typeof schema.channels.$inferInsert;
const channel = (c: Omit<NewChannel, "credentials"> & { credentials: Record<string, string> }): NewChannel => ({
  ...c,
  credentials: encrypt(JSON.stringify(c.credentials)),
});
await db.insert(schema.channels).values([
  // highest priority but broken: requests must fail over to the next channel
  channel({ name: "broken reseller", provider: "openai_compatible", source: "reseller", baseUrl: `${MOCK}/broken/v1`, credentials: { apiKey: "x" }, models: ["gpt-test"], priority: 10 }),
  channel({ name: "openai official", provider: "openai", source: "official", baseUrl: `${MOCK}/openai/v1`, credentials: { apiKey: "up-openai" }, models: ["gpt-test", "embed-test", "tier-test", "dalle-test", "tts-test", "whisper-test", "flex-test", "gpt-batch", "ptu-test"], modelMapping: { "gpt-test": "gpt-upstream", "whisper-test": "whisper-upstream", "gpt-batch": "gpt-4o-batch-up" }, costMultiplier: 0.9 }),
  // committed capacity that is always full: traffic spills to the pay-as-you-go channel above
  channel({ name: "ptu", provider: "azure_openai", source: "cloud", baseUrl: `${MOCK}/ptu/v1`, credentials: { apiKey: "up-azure" }, models: ["ptu-test"], priority: 10, fixedCostHourly: 1, capacityTpm: 1000 }),
  // a DeepInfra-style relay: batches on, its own batch price (80% of list), an org header
  channel({ name: "batch relay", provider: "openai_compatible", source: "reseller", baseUrl: `${MOCK}/openai/v1`, config: { batch: "on", batchCostFactor: "0.8", extraHeaders: "X-Organization-ID: org_e2e" }, credentials: { apiKey: "up-openai" }, models: ["relay-batch"], modelMapping: { "relay-batch": "gpt-4o-batch-up" } }),
  // the same open model on two per-token providers, each with its own price for it
  channel({ name: "deepinfra-like", provider: "openai_compatible", source: "reseller", baseUrl: `${MOCK}/openai/v1`, config: { batch: "on", batchCostFactor: "0.8" }, credentials: { apiKey: "up-openai" }, models: ["oss-model"], modelMapping: { "oss-model": "gpt-4o-batch-up" }, modelCosts: { "oss-model": { input: 0.5, output: 1 } }, priority: 10 }),
  channel({ name: "novita-like", provider: "openai_compatible", source: "reseller", baseUrl: `${MOCK}/openai/v1`, config: { batch: "on", batchCostFactor: "0.5" }, credentials: { apiKey: "up-openai" }, models: ["oss-model"], modelMapping: { "oss-model": "gpt-4o-batch-up" }, modelCosts: { "oss-model": { input: 0.6, output: 1.2 } }, priority: 5 }),
  channel({ name: "anthropic official", provider: "anthropic", source: "official", baseUrl: `${MOCK}/anthropic`, credentials: { apiKey: "up-anthropic" }, models: ["claude-batch", "claude-batch-big"], modelMapping: { "claude-batch": "claude-up", "claude-batch-big": "claude-up-big" } }),
  channel({ name: "reranker", provider: "openai_compatible", source: "reseller", baseUrl: `${MOCK}/openai/v1`, credentials: { apiKey: "up-openai" }, models: ["rerank-test"] }),
  channel({ name: "creditless", provider: "anthropic_compatible", source: "reseller", baseUrl: `${MOCK}/creditless`, credentials: { apiKey: "x" }, models: ["fault-test"], priority: 9 }),
  channel({ name: "azure", provider: "azure_openai", source: "cloud", baseUrl: `${MOCK}/azure/openai/v1`, credentials: { apiKey: "up-azure" }, models: ["azure-test"] }),
  channel({ name: "anthropic relay", provider: "anthropic_compatible", source: "reseller", baseUrl: `${MOCK}/anthropic`, credentials: { apiKey: "up-anthropic" }, models: ["claude-test", "fault-test"], priority: 5 }),
  channel({ name: "bedrock", provider: "bedrock", source: "cloud", baseUrl: `${MOCK}/bedrock`, config: { region: "us-east-1" }, credentials: { apiKey: "up-bedrock" }, models: ["claude-test"], modelMapping: { "claude-test": "us.anthropic.claude-test-v1:0" } }),
  channel({ name: "vertex", provider: "vertex", source: "cloud", baseUrl: `${MOCK}/vertex`, config: { location: "global" }, credentials: { serviceAccount }, models: ["claude-vertex", "gemini-test"] }),
  channel({ name: "flaky", provider: "openai_compatible", source: "reseller", baseUrl: `${MOCK}/flaky/v1`, credentials: { apiKey: "x" }, models: ["flaky-test"] }),
  channel({ name: "reset", provider: "openai_compatible", source: "reseller", baseUrl: `${MOCK}/reset/v1`, credentials: { apiKey: "x" }, models: ["reset-test"] }),
  channel({ name: "slow", provider: "openai_compatible", source: "reseller", baseUrl: `${MOCK}/slow/v1`, credentials: { apiKey: "x" }, models: ["slow-test"] }),
  channel({ name: "gemini official", provider: "gemini", source: "official", baseUrl: `${MOCK}/gemini`, credentials: { apiKey: "up-gemini" }, models: ["gemini-test"], priority: 5 }),
  channel({ name: "unmetered", provider: "openai_compatible", source: "cloud", baseUrl: `${MOCK}/nomusage/v1`, credentials: { apiKey: "x" }, models: ["nomusage-test"] }),
]);


const [user] = await db.insert(schema.users).values({ email: "buyer@example.com", balance: 1_000_000 }).returning();
const key = generateApiKey();
await db.insert(schema.apiKeys).values({ userId: user.id, name: "e2e", keyHash: sha256(key), keyPrefix: key.slice(0, 12) });

// The app caches channels, prices and settings for ~10s; let anything left from a previous run expire.
await new Promise((r) => setTimeout(r, 10_500));

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
const balanceOfUser = async () => (await db.select().from(schema.users).where(eq(schema.users.id, user.id)))[0].balance;
const settings = (value: unknown) =>
  db.insert(schema.settings).values({ key: "routing", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });

// A fresh install routes from cloud capacity only (the vendors' own APIs may not be resold). This
// install opts into every source, the way an admin does after getting the vendors' permission.
await settings({ ...DEFAULT_ROUTING, enabledSources: [...schema.SOURCES] });

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

await step("OpenAI Chat request for a Claude model is translated to Anthropic (via Bedrock) and back", async () => {
  const res = await post("/v1/chat/completions", { model: "claude-test", messages: [{ role: "system", content: "s" }, { role: "user", content: "hi" }] });
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.equal(body.object, "chat.completion");
  assert.equal(body.choices[0].message.content, "pong");
  assert.equal(body.usage.prompt_tokens, 11);
  const sent = mock.received.filter((r) => r.path.startsWith("/bedrock/")).at(-1)!;
  assert.equal(sent.body.system, "s");
  assert.ok(sent.body.max_tokens > 0);
  await logsSettled(++logs);
  assert.match((await lastLog()).endpoint, /→ anthropic-messages/);
});

await step("Streaming translation emits OpenAI chunks, a usage chunk and [DONE]", async () => {
  const text = await (await post("/v1/chat/completions", { model: "claude-test", stream: true, stream_options: { include_usage: true }, messages: [{ role: "user", content: "hi" }] })).text();
  const events = text.split("\n\n").filter(Boolean).map((l) => l.slice(6));
  assert.equal(events.at(-1), "[DONE]");
  const chunks = events.slice(0, -1).map((e) => JSON.parse(e));
  assert.equal(chunks.map((c) => c.choices[0]?.delta?.content ?? "").join(""), "pong");
  assert.equal(chunks.at(-1).usage.completion_tokens, 7);
  await logsSettled(++logs);
  assert.equal((await lastLog()).outputTokens, 7);
});

await step("OpenAI Chat request for a Gemini model is translated (via Vertex)", async () => {
  const res = await post("/v1/chat/completions", { model: "gemini-test", messages: [{ role: "user", content: "hi" }] });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await res.json()).choices[0].message.content, "pong");
  await logsSettled(++logs);
});

await step("Untranslatable input is a clean OpenAI-style 400", async () => {
  const res = await post("/v1/chat/completions", {
    model: "gemini-test",
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }] }],
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error.message, /base64/);
  await logsSettled(++logs);
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
  assert.equal((await fetch(`${BASE}/api/cron/maintenance`)).status, 401);
  const res = await fetch(`${BASE}/api/cron/maintenance`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  assert.equal((await res.json()).released, 1);
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

// ---------- P1: groups, auto-recovery, low-balance alert ----------
await step("Pricing group multiplier discounts every request", async () => {
  const [group] = await db.insert(schema.pricingGroups).values({ name: "wholesale", multiplier: 0.5 }).returning();
  await db.update(schema.users).set({ groupId: group.id, balance: 1_000_000 }).where(eq(schema.users.id, user.id));
  await new Promise((r) => setTimeout(r, 10_500)); // groups cache TTL
  assert.equal((await post("/v1/chat/completions", { model: "gpt-test", messages: [] })).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  const log = (await db.select().from(schema.usageLogs).where(eq(schema.usageLogs.model, "gpt-test")).orderBy(sql`id desc`).limit(1))[0];
  // 16 input * $2 + 5 output * $8 + 4 cached * $1 = 76 list, halved
  assert.equal(log.cost, Math.ceil(76 * 0.5));
  await db.update(schema.users).set({ groupId: null }).where(eq(schema.users.id, user.id));
});

await step("A failing channel is auto-disabled, then re-enabled by the maintenance probe once healthy", async () => {
  await settings({ enabledSources: ["official", "cloud", "reseller"], modelSources: {}, maxAttempts: 3, autoDisableAfter: 2 });
  await new Promise((r) => setTimeout(r, 10_500));
  for (let i = 0; i < 2; i++) assert.equal((await post("/v1/chat/completions", { model: "flaky-test", messages: [] })).status, 503);
  await new Promise((r) => setTimeout(r, 300));
  const flaky = async () => (await db.select().from(schema.channels).where(eq(schema.channels.name, "flaky")))[0];
  assert.equal((await flaky()).enabled, false);
  assert.ok((await flaky()).autoDisabledAt);
  const cron = () => fetch(`${BASE}/api/cron/maintenance`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }).then((r) => r.json());
  assert.equal((await cron()).recovered, 0);
  mock.heal();
  assert.equal((await cron()).recovered, 1);
  assert.equal((await flaky()).enabled, true);
  assert.equal((await flaky()).autoDisabledAt, null);
});

await step("Dropping below the low-balance threshold flags the account once", async () => {
  await db.update(schema.users).set({ balance: 1_000_000, lowBalanceThreshold: 2_000_000, lowBalanceNotifiedAt: null }).where(eq(schema.users.id, user.id));
  assert.equal((await post("/v1/chat/completions", { model: "gpt-test", messages: [] })).status, 200);
  await new Promise((r) => setTimeout(r, 500));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  assert.ok(u.lowBalanceNotifiedAt, "notified");
  logs = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.usageLogs))[0].n;
});

// ---------- P1 review fixes & P2 endpoints ----------
await step("A provider-account 400 (out of credit) fails over instead of reaching the customer", async () => {
  await settings({ enabledSources: ["official", "cloud", "reseller"], modelSources: {}, maxAttempts: 3, autoDisableAfter: 0 });
  await new Promise((r) => setTimeout(r, 10_500));
  const res = await post("/v1/messages", { model: "fault-test", max_tokens: 5, messages: [] }, { "x-api-key": key });
  assert.equal(res.status, 200, await res.clone().text());
  const [c] = await db.select().from(schema.channels).where(eq(schema.channels.name, "creditless"));
  assert.match(c.lastError ?? "", /credit balance/);
});

const lastCost = async (model: string) => {
  await new Promise((r) => setTimeout(r, 300));
  return (await db.select().from(schema.usageLogs).where(eq(schema.usageLogs.model, model)).orderBy(sql`id desc`).limit(1))[0];
};

await step("Long-context tier prices the whole request at tier rates", async () => {
  assert.equal((await post("/v1/chat/completions", { model: "tier-test", messages: [] })).status, 200);
  // prompt 20 (16 + 4 cached) > 10: 16*3 + 5*4 + 4*(1*3) = 80
  assert.equal((await lastCost("tier-test")).cost, 80);
});

await step("Image generation is billed per image", async () => {
  const res = await post("/v1/images/generations", { model: "dalle-test", prompt: "cat", n: 2 });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data.length, 2);
  assert.equal((await lastCost("dalle-test")).cost, 2 * 40_000);
});

await step("Text-to-speech returns audio bytes and bills per character", async () => {
  const res = await post("/v1/audio/speech", { model: "tts-test", input: "hello", voice: "alloy" });
  assert.equal(res.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0xff, 0xfb, 0x90, 0x00, 0x01, 0x02]);
  assert.equal((await lastCost("tts-test")).cost, 5 * 15);
});

await step("Transcription forwards multipart with the mapped model and bills per started minute", async () => {
  const form = new FormData();
  form.append("model", "whisper-test");
  form.append("file", new Blob([new Uint8Array(2000)], { type: "audio/mpeg" }), "a.mp3");
  const res = await fetch(`${BASE}/v1/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await res.json()).text, "hello world");
  assert.equal((await lastCost("whisper-test")).cost, 2 * 6_000);
});

await step("Rerank is billed by tokens", async () => {
  const res = await post("/v1/rerank", { model: "rerank-test", query: "q", documents: ["a"] });
  assert.equal(res.status, 200);
  assert.equal((await lastCost("rerank-test")).cost, Math.ceil(100 * 0.05));
});

await step("count_tokens is forwarded to an Anthropic channel, free", async () => {
  const res = await post("/v1/messages/count_tokens", { model: "claude-test", messages: [{ role: "user", content: "hi" }] }, { "x-api-key": key });
  assert.deepEqual(await res.json(), { input_tokens: 42 });
  const est = await post("/v1/messages/count_tokens", { model: "gpt-test", messages: [{ role: "user", content: "hi" }] }, { "x-api-key": key });
  assert.ok((await est.json()).input_tokens > 0);
});

await step("Redeem codes credit once per user and respect max uses", async () => {
  const { generateRedeemCodes, redeemCode } = await import("../src/lib/redeem");
  const [code] = await generateRedeemCodes({ count: 1, amount: 5_000_000, maxUses: 1, expiresAt: null, batch: "e2e", createdBy: 0 });
  const before = await balanceOfUser();
  assert.deepEqual(await redeemCode(user.id, code.toLowerCase().replace(/-/g, " ")), { ok: true, amount: 5_000_000 });
  assert.equal(await balanceOfUser(), before + 5_000_000);
  assert.equal((await redeemCode(user.id, code)).ok, false);
  const [other] = await db.insert(schema.users).values({ email: "other@example.com" }).returning();
  assert.match(((await redeemCode(other.id, code)) as { error: string }).error, /already been used/);
  assert.match(((await redeemCode(user.id, "TX-NOPE-NOPE-NOPE-NOPE")) as { error: string }).error, /not valid/);
  logs = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.usageLogs))[0].n;
});

// ---------- service tiers, committed capacity, batches ----------
const lastUpstream = (prefix: string) => [...mock.received].reverse().find((r) => r.path.startsWith(prefix))!;

await step("service_tier: a tier the model is not offered on is stripped; flex is billed at the flex markup", async () => {
  let res = await post("/v1/chat/completions", { model: "gpt-test", service_tier: "priority", messages: [{ role: "user", content: "hi" }] });
  assert.equal(res.status, 200);
  await logsSettled(++logs);
  assert.equal(lastUpstream("/openai/v1/chat").body.service_tier, undefined);
  assert.equal((await lastLog()).serviceTier, null);

  res = await post("/v1/chat/completions", { model: "flex-test", service_tier: "flex", messages: [{ role: "user", content: "hi" }] });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).service_tier, "flex");
  await logsSettled(++logs);
  assert.equal(lastUpstream("/openai/v1/chat").body.service_tier, "flex");
  const log = await lastLog();
  // 16 input + 4 cached (cache price falls back to input) at $2, 5 output at $8 = 80 list
  assert.equal(log.serviceTier, "flex");
  assert.equal(log.cost, 64);
  assert.equal(log.upstreamCost, 36); // 80 x 0.5 (flex) x 0.9 (channel)

  res = await post("/v1/messages", { model: "claude-test", max_tokens: 10, service_tier: "auto", messages: [{ role: "user", content: "hi" }] }, { "x-api-key": key });
  assert.equal(res.status, 200);
  await logsSettled(++logs);
  assert.equal("service_tier" in lastUpstream("/anthropic/v1/messages").body, false);
});

await step("A full committed-capacity channel spills over without counting as a failure", async () => {
  const [ptu] = await db.select().from(schema.channels).where(eq(schema.channels.name, "ptu"));
  const res = await post("/v1/chat/completions", { model: "ptu-test", messages: [{ role: "user", content: "hi" }] });
  assert.equal(res.status, 200);
  await logsSettled(++logs);
  assert.ok(lastUpstream("/ptu/"), "the PTU was tried first");
  assert.notEqual((await lastLog()).channelId, ptu.id);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await db.select().from(schema.channels).where(eq(schema.channels.id, ptu.id)))[0].failCount, 0);

  // Over its tokens-per-minute capacity, the PTU is not even tried.
  const now = Math.floor(Date.now() / 1000);
  await db.insert(schema.rateLimits).values({ bucket: `tpm:ch:${ptu.id}`, windowStart: now - (now % 60), count: 5000 }).onConflictDoUpdate({ target: schema.rateLimits.bucket, set: { windowStart: now - (now % 60), count: 5000 } });
  const before = mock.received.filter((r) => r.path.startsWith("/ptu/")).length;
  assert.equal((await post("/v1/chat/completions", { model: "ptu-test", messages: [{ role: "user", content: "hi" }] })).status, 200);
  await logsSettled(++logs);
  assert.equal(mock.received.filter((r) => r.path.startsWith("/ptu/")).length, before);
});

await step("OpenAI batch: upload, create (hold), poll (bill at batch price), download output", async () => {
  const line = (id: string) => JSON.stringify({ custom_id: id, method: "POST", url: "/v1/chat/completions", body: { model: "gpt-batch", messages: [{ role: "user", content: "hi" }] } });
  const form = new FormData();
  form.set("purpose", "batch");
  form.set("file", new Blob([[line("a"), line("b"), line("c-fail")].join("\n")]), "in.jsonl");
  let res = await fetch(`${BASE}/v1/files`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form });
  assert.equal(res.status, 200);
  const file = await res.json();
  assert.equal(file.purpose, "batch");

  const before = await balanceOfUser();
  res = await post("/v1/batches", { input_file_id: file.id, endpoint: "/v1/chat/completions", completion_window: "24h", metadata: { job: "e2e" } });
  assert.equal(res.status, 200, await res.clone().text());
  const created = await res.json();
  assert.match(created.id, /^batch_tx/);
  assert.equal(created.input_file_id, file.id);
  const sent = lastUpstream("/openai/v1/batches");
  assert.equal(sent.body.endpoint, "/v1/chat/completions");
  assert.ok((await balanceOfUser()) < before, "the worst case is held");

  res = await fetch(`${BASE}/v1/batches/${created.id}`, { headers: { authorization: `Bearer ${key}` } });
  const batch = await res.json();
  assert.equal(batch.status, "completed");
  assert.deepEqual(batch.request_counts, { total: 3, completed: 2, failed: 1 });
  assert.match(batch.output_file_id, /^file-tx/);
  assert.ok(batch.error_file_id);
  logs++;
  const log = await lastLog();
  // 2 successful requests x (100 in, 10 out) = 200 x $2 + 20 x $8 = 560 list
  assert.equal(log.model, "gpt-batch");
  assert.equal(log.serviceTier, "batch");
  assert.equal(log.cost, 448); // x 0.8
  assert.equal(log.upstreamCost, 252); // x 0.5 x 0.9
  assert.equal(await balanceOfUser(), before - 448, "the hold is released and only usage is billed");

  // Polling again does not bill twice.
  await fetch(`${BASE}/v1/batches/${created.id}`, { headers: { authorization: `Bearer ${key}` } });
  assert.equal(await balanceOfUser(), before - 448);

  res = await fetch(`${BASE}/v1/files/${batch.output_file_id}/content`, { headers: { authorization: `Bearer ${key}` } });
  const out = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(out.map((l) => l.custom_id), ["a", "b"]);
  assert.equal(out[0].response.body.model, "gpt-batch", "upstream model ids are not exposed");

  const list = await (await fetch(`${BASE}/v1/batches?limit=5`, { headers: { authorization: `Bearer ${key}` } })).json();
  assert.equal(list.data[0].id, created.id);

  res = await post("/v1/batches", { input_file_id: file.id, endpoint: "/v1/embeddings" });
  assert.equal(res.status, 400, "lines must match the batch endpoint");
});

await step("Relay batch (DeepInfra-style): extra header sent, billed at the relay's own batch price", async () => {
  const line = (id: string) => JSON.stringify({ custom_id: id, method: "POST", url: "/v1/chat/completions", body: { model: "relay-batch", messages: [{ role: "user", content: "hi" }] } });
  const form = new FormData();
  form.set("purpose", "batch");
  form.set("file", new Blob([[line("a"), line("b")].join("\n")]), "in.jsonl");
  const file = await (await fetch(`${BASE}/v1/files`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form })).json();
  const before = await balanceOfUser();
  let res = await post("/v1/batches", { input_file_id: file.id, endpoint: "/v1/chat/completions" });
  assert.equal(res.status, 200, await res.clone().text());
  const { id } = await res.json();
  assert.equal(lastUpstream("/openai/v1/files").headers["x-organization-id"], "org_e2e");
  assert.equal(lastUpstream("/openai/v1/batches").headers["x-organization-id"], "org_e2e");
  res = await fetch(`${BASE}/v1/batches/${id}`, { headers: { authorization: `Bearer ${key}` } });
  assert.equal((await res.json()).status, "completed");
  logs++;
  const log = await lastLog();
  // 2 x (100 in, 10 out) = 560 list: customer 0.9 -> 504, upstream 0.8 -> 448
  assert.equal(log.cost, 504);
  assert.equal(log.upstreamCost, 448);
  assert.equal(await balanceOfUser(), before - 504);
});

// Real-time requests on the relay carry the header too.
await step("Relay channels send their extra headers on live requests", async () => {
  const res = await post("/v1/chat/completions", { model: "relay-batch", messages: [{ role: "user", content: "hi" }] });
  assert.equal(res.status, 200);
  await logsSettled(++logs);
  assert.equal(lastUpstream("/openai/v1/chat").headers["x-organization-id"], "org_e2e");
});

await step("Per-model upstream costs: live traffic on the priority provider, batches on the cheapest batch provider", async () => {
  const [di] = await db.select().from(schema.channels).where(eq(schema.channels.name, "deepinfra-like"));
  const [nv] = await db.select().from(schema.channels).where(eq(schema.channels.name, "novita-like"));
  let res = await post("/v1/chat/completions", { model: "oss-model", messages: [{ role: "user", content: "hi" }] });
  assert.equal(res.status, 200);
  await logsSettled(++logs);
  let log = await lastLog();
  // 16 input + 4 cached (falls back to input) + 5 output: list 30 x 1.2 = 36; DeepInfra's own cost 10 + 5 = 15
  assert.equal(log.channelId, di.id);
  assert.equal(log.cost, 36);
  assert.equal(log.upstreamCost, 15);

  const line = (id: string) => JSON.stringify({ custom_id: id, method: "POST", url: "/v1/chat/completions", body: { model: "oss-model", messages: [{ role: "user", content: "hi" }] } });
  const form = new FormData();
  form.set("purpose", "batch");
  form.set("file", new Blob([[line("a"), line("b")].join("\n")]), "in.jsonl");
  const file = await (await fetch(`${BASE}/v1/files`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form })).json();
  res = await post("/v1/batches", { input_file_id: file.id, endpoint: "/v1/chat/completions" });
  assert.equal(res.status, 200, await res.clone().text());
  const { id } = await res.json();
  await fetch(`${BASE}/v1/batches/${id}`, { headers: { authorization: `Bearer ${key}` } });
  logs++;
  log = await lastLog();
  // 200 in + 20 out: list 240 x 0.9 = 216. Novita batch (120 + 24) x 0.5 = 72 beats DeepInfra (100 + 20) x 0.8 = 96
  assert.equal(log.channelId, nv.id);
  assert.equal(log.cost, 216);
  assert.equal(log.upstreamCost, 72);
});

await step("Upstream catalogs are read from DeepInfra's and Novita's price lists", async () => {
  const { fetchCatalog } = await import("../src/lib/upstream-catalog");
  const base = { id: 0, name: "c", provider: "openai_compatible" as const, credentials: {}, models: [], modelMapping: {}, modelCosts: {} } as never as Parameters<typeof fetchCatalog>[0];
  const deepinfra = await fetchCatalog({ ...base, baseUrl: `${MOCK}/v1/openai`, config: { catalog: "deepinfra" }, credentials: { apiKey: "x" } });
  assert.deepEqual(deepinfra, [{ id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", cost: { input: 0.1, output: 0.32 }, contextSize: 131072 }]);
  const novita = await fetchCatalog({ ...base, baseUrl: `${MOCK}/novita/openai/v1`, config: { catalog: "novita" }, credentials: { apiKey: "up-novita" } });
  assert.deepEqual(novita, [{ id: "meta-llama/llama-3.3-70b-instruct", cost: { input: 0.135, output: 0.4 }, contextSize: 131072 }]);
});

await step("Anthropic message batch: create, poll, bill, results, delete", async () => {
  const before = await balanceOfUser();
  let res = await post(
    "/v1/messages/batches",
    {
      requests: [
        { custom_id: "one", params: { model: "claude-batch", max_tokens: 100, messages: [{ role: "user", content: "hi" }] } },
        // no max_tokens: the gateway caps it at what is held
        { custom_id: "two", params: { model: "claude-batch", messages: [{ role: "user", content: "hi" }] } },
      ],
    },
    { "x-api-key": key },
  );
  assert.equal(res.status, 200, await res.clone().text());
  const created = await res.json();
  assert.match(created.id, /^msgbatch_tx/);
  assert.equal(created.processing_status, "in_progress");

  const batch = await (await fetch(`${BASE}/v1/messages/batches/${created.id}`, { headers: { "x-api-key": key } })).json();
  assert.equal(batch.processing_status, "ended");
  assert.equal(batch.results_url, `${BASE}/v1/messages/batches/${created.id}/results`);
  logs++;
  const log = await lastLog();
  // 2 x (200 in, 20 out) = 400 x $3 + 40 x $15 = 1800 list
  assert.equal(log.cost, 1440);
  assert.equal(log.upstreamCost, 900);
  assert.equal(await balanceOfUser(), before - 1440);

  const results = (await (await fetch(batch.results_url, { headers: { "x-api-key": key } })).text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(results.map((r) => r.result.message.model), ["claude-batch", "claude-batch"]);

  res = await fetch(`${BASE}/v1/messages/batches/${created.id}`, { method: "DELETE", headers: { "x-api-key": key } });
  assert.equal((await res.json()).type, "message_batch_deleted");
});

await step("A mixed-model Anthropic batch bills each request at its own model, even when results report dated ids", async () => {
  const before = await balanceOfUser();
  const res = await post(
    "/v1/messages/batches",
    {
      requests: [
        // cheap model first: billing must not fall back to it
        { custom_id: "cheap", params: { model: "claude-batch", max_tokens: 100, messages: [{ role: "user", content: "hi" }] } },
        { custom_id: "big", params: { model: "claude-batch-big", max_tokens: 100, messages: [{ role: "user", content: "hi" }] } },
      ],
    },
    { "x-api-key": key },
  );
  assert.equal(res.status, 200, await res.clone().text());
  const { id } = await res.json();
  await fetch(`${BASE}/v1/messages/batches/${id}`, { headers: { "x-api-key": key } });
  logs += 2;
  const rows = await db.select().from(schema.usageLogs).orderBy(sql`id desc`).limit(2);
  const cost = Object.fromEntries(rows.map((r) => [r.model, r.cost]));
  // 200 in + 20 out each: 900 list x 0.8 = 720; 4500 list x 0.8 = 3600
  assert.deepEqual(cost, { "claude-batch": 720, "claude-batch-big": 3600 });
  assert.equal(await balanceOfUser(), before - 4320);
  const results = (await (await fetch(`${BASE}/v1/messages/batches/${id}/results`, { headers: { "x-api-key": key } })).text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(Object.fromEntries(results.map((r) => [r.custom_id, r.result.message.model])), { cheap: "claude-batch", big: "claude-batch-big" });
});

await step("Batch input files with NUL bytes are rejected", async () => {
  const form = new FormData();
  form.set("purpose", "batch");
  form.set("file", new Blob(['{"custom_id":"a\u0000"}']), "bad.jsonl");
  const res = await fetch(`${BASE}/v1/files`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form });
  assert.equal(res.status, 400);
});

await step("Batches are refused for models without a batch price", async () => {
  const res = await post("/v1/messages/batches", { requests: [{ custom_id: "x", params: { model: "claude-test", max_tokens: 5, messages: [] } }] }, { "x-api-key": key });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error.message, /not offered/);
});

await step("A successful response with no usage is charged the held worst case and fails loudly", async () => {
  const before = await balanceOfUser();
  const res = await post("/v1/chat/completions", { model: "nomusage-test", messages: [{ role: "user", content: "hi" }] });
  assert.equal(res.status, 502, await res.clone().text());
  assert.equal((await res.json()).error.code, "metering_unavailable");
  await logsSettled(++logs);
  const log = await lastLog();
  assert.match(log.error ?? "", /metering_unavailable/);
  assert.ok(log.cost > 0, "an unmetered request must never be free");
  assert.equal(before - (await balanceOfUser()), log.cost);
});

await step("A stream that never reports usage errors the stream and is still charged", async () => {
  const before = await balanceOfUser();
  const res = await post("/v1/chat/completions", { model: "nomusage-test", stream: true, messages: [] });
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    text = `stream aborted: ${err}`;
  }
  assert.match(text, /metering_unavailable|stream aborted/, text);
  await logsSettled(++logs);
  const log = await lastLog();
  assert.match(log.error ?? "", /metering_unavailable/);
  assert.ok(log.cost > 0, "an unmetered stream must never be free");
  assert.equal(before - (await balanceOfUser()), log.cost);
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
  // a top-up re-arms the low-balance email
  assert.equal((await db.select().from(schema.users).where(eq(schema.users.id, user.id)))[0].lowBalanceNotifiedAt, null);
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

await step("A chargeback debits the credit, disables the account and blocks its keys, exactly once", async () => {
  const before = await balanceOf();
  const dispute = { id: "dp_e2e", object: "dispute", charge: "ch_e2e", amount: 2000, currency: "usd", reason: "fraudulent", status: "needs_response" };
  assert.equal((await sendEvent("charge.dispute.created", dispute)).status, 200);
  assert.equal((await sendEvent("charge.dispute.created", dispute)).status, 200);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  assert.equal(u.balance, before - 20_000_000);
  assert.equal(u.disabled, true);
  const res = await post("/v1/chat/completions", { model: "gpt-test", messages: [{ role: "user", content: "hi" }] });
  assert.equal(res.status, 403);
  const [entry] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "stripe.dispute_opened"));
  assert.equal(entry.target, `user:${user.id}`);
  // A dispute on a charge with no customer is ignored.
  assert.equal((await sendEvent("charge.dispute.created", { ...dispute, id: "dp_orphan", charge: "ch_orphan" })).status, 200);
});

await step("A won dispute restores the credit once; a lost one changes nothing; the account stays locked", async () => {
  const before = await balanceOf();
  await sendEvent("charge.dispute.closed", { id: "dp_e2e", object: "dispute", charge: "ch_e2e", amount: 2000, reason: "fraudulent", status: "won" });
  await sendEvent("charge.dispute.closed", { id: "dp_e2e", object: "dispute", charge: "ch_e2e", amount: 2000, reason: "fraudulent", status: "won" });
  assert.equal(await balanceOf(), before + 20_000_000);
  await sendEvent("charge.dispute.closed", { id: "dp_lost", object: "dispute", charge: "ch_e2e", amount: 500, reason: "fraudulent", status: "lost" });
  assert.equal(await balanceOf(), before + 20_000_000);
  assert.equal((await db.select().from(schema.users).where(eq(schema.users.id, user.id)))[0].disabled, true);
});

console.log("\nall e2e checks passed");
mock.close();
await client.end();
// The redeem step imports app modules that hold their own connection pool.
process.exit(0);
