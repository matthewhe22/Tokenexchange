import { eq, sql } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { getSecuritySettings } from "./settings";

const COOKIE = "tx_session";
const MAX_AGE = 60 * 60 * 24 * 7;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(s);
}

export async function createSession(userId: number, sessionVersion: number): Promise<void> {
  const token = await new SignJWT({ sv: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const [user] = await getDb().select().from(schema.users).where(eq(schema.users.id, Number(payload.sub)));
    // A password change bumps sessionVersion, which signs out every older session.
    if (!user || user.disabled || (payload.sv ?? 0) !== user.sessionVersion) return null;
    return user;
  } catch {
    return null;
  }
}

/** Guards customer pages and server actions. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** Guards admin pages and server actions. */
export async function requireAdmin() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "admin") redirect("/dashboard");
  if (!user.totpEnabledAt && (await getSecuritySettings()).requireAdmin2fa) redirect("/dashboard/account?require2fa=1");
  return user;
}

/**
 * Invalidates every session of the user, optionally applying other column changes (e.g. a new
 * password hash) in the same statement so they can never be half-applied. Returns the new version.
 */
export async function bumpSessionVersion(userId: number, also: Partial<typeof schema.users.$inferInsert> = {}): Promise<number> {
  const [row] = await getDb()
    .update(schema.users)
    .set({ ...also, sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(eq(schema.users.id, userId))
    .returning({ v: schema.users.sessionVersion });
  return row.v;
}

// ---------- second factor ----------

const PENDING_COOKIE = "tx_2fa";

/** After the password (or OAuth) step for a user with 2FA: remember who is half-signed-in for 5 minutes. */
export async function createPendingTwoFactor(userId: number, sessionVersion: number): Promise<void> {
  const token = await new SignJWT({ sv: sessionVersion, purpose: "2fa" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret());
  (await cookies()).set(PENDING_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 300,
  });
}

export async function readPendingTwoFactor() {
  const token = (await cookies()).get(PENDING_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.purpose !== "2fa") return null;
    const [user] = await getDb().select().from(schema.users).where(eq(schema.users.id, Number(payload.sub)));
    if (!user || user.disabled || payload.sv !== user.sessionVersion || !user.totpEnabledAt) return null;
    return user;
  } catch {
    return null;
  }
}

export async function clearPendingTwoFactor(): Promise<void> {
  (await cookies()).delete(PENDING_COOKIE);
}
