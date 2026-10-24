import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";

// Creates the first admin and a starter price list.
// The prices are examples only: check each vendor's current pricing page before going live.
const EXAMPLE_PRICES: (typeof schema.modelPrices.$inferInsert)[] = [
  { model: "gpt-4o", inputPrice: 2.5, outputPrice: 10, cacheReadPrice: 1.25, maxOutputTokens: 16_384 },
  { model: "gpt-4o-mini", inputPrice: 0.15, outputPrice: 0.6, cacheReadPrice: 0.075, maxOutputTokens: 16_384 },
  { model: "gpt-4.1", inputPrice: 2, outputPrice: 8, cacheReadPrice: 0.5, maxOutputTokens: 32_768 },
  { model: "text-embedding-3-small", inputPrice: 0.02, outputPrice: 0 },
  { model: "claude-sonnet-4-5", inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3, cacheWritePrice: 3.75, maxOutputTokens: 64_000 },
  { model: "claude-haiku-4-5", inputPrice: 1, outputPrice: 5, cacheReadPrice: 0.1, cacheWritePrice: 1.25, maxOutputTokens: 64_000 },
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

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const email = process.env.ADMIN_EMAIL?.toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!url || !email || !password) throw new Error("DATABASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD are required");

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
