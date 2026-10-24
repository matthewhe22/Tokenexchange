import { appUrl } from "./url";

export type OAuthProvider = "github" | "google";

interface ProviderConfig {
  label: string;
  clientId?: string;
  clientSecret?: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
}

const PROVIDERS: Record<OAuthProvider, ProviderConfig> = {
  github: {
    label: "GitHub",
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
  },
  google: {
    label: "Google",
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email",
  },
};

export function isOAuthProvider(p: string): p is OAuthProvider {
  return p === "github" || p === "google";
}

export function enabledOAuthProviders(): { id: OAuthProvider; label: string }[] {
  return (Object.keys(PROVIDERS) as OAuthProvider[])
    .filter((id) => PROVIDERS[id].clientId && PROVIDERS[id].clientSecret)
    .map((id) => ({ id, label: PROVIDERS[id].label }));
}

function config(p: OAuthProvider): Required<ProviderConfig> {
  const c = PROVIDERS[p];
  if (!c.clientId || !c.clientSecret) throw new Error(`${p} sign-in is not configured`);
  return c as Required<ProviderConfig>;
}

export function redirectUri(p: OAuthProvider): string {
  return `${appUrl()}/api/auth/${p}/callback`;
}

export function authorizeUrl(p: OAuthProvider, state: string): string {
  const c = config(p);
  const params = new URLSearchParams({ client_id: c.clientId, redirect_uri: redirectUri(p), scope: c.scope, state });
  if (p === "google") {
    params.set("response_type", "code");
    params.set("prompt", "select_account");
  }
  return `${c.authorizeUrl}?${params}`;
}

/** Exchanges the code and returns the account's email, but only if the provider has verified it. */
export async function verifiedEmailFromCode(p: OAuthProvider, code: string): Promise<string | null> {
  const c = config(p);
  const tokenRes = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      code,
      redirect_uri: redirectUri(p),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) return null;
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) return null;

  if (p === "github") {
    const res = await fetch("https://api.github.com/user/emails", {
      headers: { authorization: `Bearer ${access_token}`, accept: "application/vnd.github+json", "user-agent": "TokenExchange" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const emails = (await res.json()) as { email: string; primary: boolean; verified: boolean }[];
    return emails.find((e) => e.primary && e.verified)?.email.toLowerCase() ?? null;
  }
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const info = (await res.json()) as { email?: string; email_verified?: boolean };
  return info.email && info.email_verified ? info.email.toLowerCase() : null;
}
