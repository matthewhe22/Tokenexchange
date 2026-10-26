/**
 * Canonical-host policy for the public site.
 *
 * One deployment answers on several hostnames: Vercel's production alias
 * (`tokenexchangeportal.vercel.app`), the canonical domain (`mytenon.com`) and the
 * `www` alias. Browser traffic on the alias hosts is sent to the canonical domain so
 * that links, cookies and search results live on a single origin.
 *
 * The canonical host is read from `APP_URL` at request time, so the redirect follows
 * configuration instead of a hardcoded string: while `APP_URL` still points at the
 * alias there is nowhere to redirect to and the redirect stays off. That makes
 * shipping this code safe before the domain is attached and serving.
 *
 * Machine endpoints are deliberately exempt on *every* host. API keys already in the
 * wild were handed out as `https://tokenexchangeportal.vercel.app/v1`, and providers
 * call back on the OAuth callback and Stripe webhook routes at the host we gave them.
 * Redirecting those would break live clients — several SDKs drop the request body on a
 * redirect — so they keep being served wherever they arrive.
 */
export const DEFAULT_CANONICAL_HOST = "mytenon.com";

/** Hosts whose browser traffic belongs on the canonical domain. */
const ALIAS_HOSTS = new Set(["tokenexchangeportal.vercel.app", "www.mytenon.com"]);

/** Paths served on every host and never redirected. */
const MACHINE_PREFIXES = ["/v1", "/v1beta", "/api"];

export function isMachinePath(pathname: string): boolean {
  return MACHINE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

/** Bare hostname of an absolute URL, or null when it is missing or unparsable. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * The absolute URL to redirect to, or null when the request should be served as-is.
 * `appUrl` defaults to `process.env.APP_URL`.
 */
export function canonicalRedirect(
  host: string | null,
  pathname: string,
  search = "",
  appUrl: string | null | undefined = process.env.APP_URL,
): string | null {
  const bare = (host ?? "").split(":")[0].trim().toLowerCase();
  if (!ALIAS_HOSTS.has(bare)) return null;
  if (isMachinePath(pathname)) return null;

  const canonical = hostOf(appUrl) ?? DEFAULT_CANONICAL_HOST;
  // Self-disabling case: APP_URL still points at an alias (or at an alias's bare host),
  // so redirecting would loop back to ourselves.
  if (bare === canonical || canonical === "www." + bare) return null;

  return "https://" + canonical + pathname + search;
}
