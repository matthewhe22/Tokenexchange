import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { authorizeUrl, enabledOAuthProviders, isOAuthProvider } from "@/lib/oauth";
import { safeNext } from "@/lib/login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isOAuthProvider(provider) || !enabledOAuthProviders().some((p) => p.id === provider)) {
    return Response.redirect(new URL("/login?error=oauth", req.url), 302);
  }
  const state = randomBytes(24).toString("base64url");
  const next = safeNext(new URL(req.url).searchParams.get("next")) ?? "";
  (await cookies()).set("tx_oauth", JSON.stringify({ state, provider, next }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return Response.redirect(authorizeUrl(provider, state), 302);
}
