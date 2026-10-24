// Connection strings under the names the Vercel Postgres integrations use (Neon, Supabase, legacy
// Vercel Postgres). Pooled for serverless functions; direct for migrations.

const POOLED = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "DATABASE_POSTGRES_URL"];
const DIRECT = ["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "DATABASE_POSTGRES_URL_NON_POOLING"];

function first(names: string[]): string | undefined {
  for (const n of names) if (process.env[n]) return process.env[n];
  return undefined;
}

export function pooledDatabaseUrl(): string | undefined {
  return first(POOLED) ?? first(DIRECT);
}

export function directDatabaseUrl(): string | undefined {
  return first(DIRECT) ?? first(POOLED);
}

/** Error that lists which database-looking variables exist (names only, never values). */
export function missingDatabaseUrlError(): Error {
  const seen = Object.keys(process.env).filter((k) => /DATABASE|POSTGRES|PG(HOST|USER|DATABASE|PASSWORD)|NEON|SUPABASE/i.test(k));
  return new Error(
    `No database URL found. Expected one of ${[...POOLED, ...DIRECT].join(", ")}. ` +
      (seen.length ? `Database-related variables present: ${seen.join(", ")}.` : "No database-related variables are present in this environment."),
  );
}
