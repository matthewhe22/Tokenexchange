/**
 * Canonical-host policy for the public site.
 *
 * One deployment answers on several hostnames: Vercel's production alias
 * (`tokenexchangeportal.vercel.app`), the canonical domain (`mytenon.com`) and the
 * `www` alias. Browser traffic on the aliases is sent to the canonical domain so that
 * links, cookies and search results live on a single origin.
 *
 * Machine endpoints are deliberately exempt on *every* host. API keys already in the
 * wild were handed out as `https://tokenexchangeportal.vercel.app/v1`, and providers
 * call back on the OAuth callback and Stripe webhook routes at the host we gave them.
 * Redirecting those would break live clients — several SDKs drop the request body on a
 * redirect — so they keep being served wherever they arrive.
 */
export const CANONICAL_HOST = "mytenon.com";

/** Hosts whose browser traffic belongs on the canonical domain. */
const ALIAS_HOSTS = new Set(["tokenexchangeportal.vercel.app", "www.mytenon.com"]);

/** Paths served on every host and never redirected. */
const MACHINE_PREFIXES = ["/v1", "/v1beta", "/api"];

export function isMachinePath(pathname: string): boolean {
  return MACHINE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

/** The absolute URL to redirect to, or null when the request should be served as-is. */
export function canonicalRedirect(host: string | null, pathname: string, search = ""): string | null {
  const bare = (host ?? "").split(":")[0].trim().toLowerCase();
  if (!ALIAS_HOSTS.has(bare)) return null;
  if (isMachinePath(pathname)) return null;
  return "https://" + CANONICAL_HOST + pathname + search;
}
