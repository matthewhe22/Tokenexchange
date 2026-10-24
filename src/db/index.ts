import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __db?: DB };

function create(): DB {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // prepare:false keeps us compatible with transaction-mode poolers (Supabase :6543, Neon pooled),
  // which is what serverless functions on Vercel should connect through.
  const client = postgres(url, { prepare: false, max: Number(process.env.DB_POOL_MAX ?? 5) });
  return drizzle(client, { schema });
}

export function getDb(): DB {
  globalForDb.__db ??= create();
  return globalForDb.__db;
}

export { schema };
