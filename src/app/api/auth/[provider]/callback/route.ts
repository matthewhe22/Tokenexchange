import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { completeLogin } from "@/lib/login";
import { isOAuthProvider, verifiedEmailFromCode } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameState(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const jar = await cookies();
  const saved = jar.get("tx_oauth")?.value;
  jar.delete("tx_oauth");
  let stored: { state?: string; provider?: string; next?: string } = {};
  try {
    stored = saved ? JSON.parse(saved) : {};
  } catch {}
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  if (!isOAuthProvider(provider) || !code || !stored.state || stored.provider !== provider || !sameState(stored.state, state)) {
    redirect("/login?error=oauth");
  }

  const email = await verifiedEmailFromCode(provider, code).catch(() => null);
  if (!email) redirect("/login?error=oauth_email");

  const db = getDb();
  let [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (user?.disabled) redirect("/login?error=disabled");
  if (!user) {
    [user] = await db.insert(schema.users).values({ email, emailVerifiedAt: new Date() }).returning();
  } else if (!user.emailVerifiedAt) {
    // The provider verified this address, which is as good as our own email check.
    [user] = await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, user.id)).returning();
  }
  return completeLogin(user, stored.next);
}
