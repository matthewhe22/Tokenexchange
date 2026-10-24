import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { directDatabaseUrl, missingDatabaseUrlError } from "../src/db/url";

// Migrations need a session-level connection: on Supabase/Neon use the direct (non-pooled) URL.
const url = directDatabaseUrl();
if (!url) throw missingDatabaseUrlError();
const client = postgres(url, { max: 1 });
await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
await client.end();
console.log("migrations applied");
