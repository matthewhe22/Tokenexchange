import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { directDatabaseUrl, missingDatabaseUrlError } from "../src/db/url";
import * as schema from "../src/db/schema";

// Creates the first admin and a starter price list.
// The prices are examples only: check each vendor's current pricing page before going live.
//
// `flexMarkup` / `batchMarkup` are what the customer pays as a multiple of list, on tiers where the
// vendor charges half of list upstream (OpenAI flex + batch, Anthropic batches, and batches for
// embeddings). 0.8 = list - 20%, i.e. a 37.5% gross margin. Leave them null for models whose vendor
// has no such tier, or that the gateway cannot run on one: a null tier means the request is refused
// by the batch endpoint and the OpenAI `flex` service tier is stripped.
const HALF_PRICE_BATCH = 0.8;
const HALF_PRICE_FLEX = 0.9;
const EXAMPLE_PRICES: (typeof schema.modelPrices.$inferInsert)[] = [
  { model: "gpt-4o", inputPrice: 2.5, outputPrice: 10, cacheReadPrice: 1.25, maxOutputTokens: 16_384, batchMarkup: HALF_PRICE_BATCH },
  { model: "gpt-4o-mini", inputPrice: 0.15, outputPrice: 0.6, cacheReadPrice: 0.075, maxOutputTokens: 16_384, batchMarkup: HALF_PRICE_BATCH },
  { model: "gpt-4.1", inputPrice: 2, outputPrice: 8, cacheReadPrice: 0.5, maxOutputTokens: 32_768, flexMarkup: HALF_PRICE_FLEX, batchMarkup: HALF_PRICE_BATCH },
  { model: "text-embedding-3-small", inputPrice: 0.02, outputPrice: 0, batchMarkup: HALF_PRICE_BATCH },
  { model: "claude-sonnet-4-5", inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3, cacheWritePrice: 3.75, maxOutputTokens: 64_000, batchMarkup: HALF_PRICE_BATCH },
  { model: "claude-haiku-4-5", inputPrice: 1, outputPrice: 5, cacheReadPrice: 0.1, cacheWritePrice: 1.25, maxOutputTokens: 64_000, batchMarkup: HALF_PRICE_BATCH },
  // Gemini batches need GCS buckets and are not supported by the gateway, so no batch price here.
  {
    model: "gemini-2.5-pro",
    inputPrice: 1.25,
    outputPrice: 10,
    cacheReadPrice: 0.31,
    maxOutputTokens: 65_536,
    tierThreshold: 200_000,
    tierInputPrice: 2.5,
    tierOutputPrice: 15,
  },
  { model: "gemini-2.5-flash", inputPrice: 0.3, outputPrice: 2.5, cacheReadPrice: 0.075, maxOutputTokens: 65_536 },
];

const url = directDatabaseUrl();
const email = process.env.ADMIN_EMAIL?.toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!url) throw missingDatabaseUrlError();
if (!email || !password) {
  // Lets the Vercel build run seed on every deploy; once the admin exists the variables can be removed.
  console.log("ADMIN_EMAIL / ADMIN_PASSWORD not set; skipping seed");
  process.exit(0);
}
if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email));
if (existing) {
  console.log(`admin ${email} already exists`);
} else {
  await db.insert(schema.users).values({ email, role: "admin", passwordHash: await bcrypt.hash(password, 10), emailVerifiedAt: new Date() });
  console.log(`created admin ${email}`);
}
await db.insert(schema.modelPrices).values(EXAMPLE_PRICES).onConflictDoNothing();
console.log("example prices ensured");
await client.end();
