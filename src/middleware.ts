import { NextResponse, type NextRequest } from "next/server";
import { canonicalRedirect } from "@/lib/canonical-host";

/**
 * Sends browser traffic that arrives on an alias host (Vercel's production alias,
 * `www.mytenon.com`) to the canonical domain. API and webhook paths are exempt —
 * see `src/lib/canonical-host.ts` for why.
 */
export function middleware(request: NextRequest) {
  const target = canonicalRedirect(
    request.headers.get("host"),
    request.nextUrl.pathname,
    request.nextUrl.search,
  );
  if (!target) return NextResponse.next();
  return NextResponse.redirect(target, 308);
}

export const config = {
  // Skip Next's immutable asset routes; every page and API path still passes through.
  matcher: "/((?!_next/static|_next/image).*)",
};
