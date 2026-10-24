// End-to-end check of the gateway against mock upstreams.
// Usage: start the app (`npm run build && npm start`), then `npx tsx scripts/e2e.ts`.
// WARNING: truncates all tables in DATABASE_URL.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { encrypt, generateApiKey, sha256 } from "../src/lib/crypto";
import { startMockUpstream } from "./mock-upstream";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const MOCK_PORT = 4010;
const MOCK = `http://localhost:${MOCK_PORT}`;

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
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
  const res = await post("/v1/messages", { model: "claude-test", messages: [] }, { "x-api-key": key });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /max_tokens/);
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

console.log("\nall e2e checks passed");
mock.close();
await client.end();
