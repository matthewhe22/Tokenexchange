import { describe, expect, it } from "vitest";
import { canonicalRedirect, hostOf, isMachinePath } from "@/lib/canonical-host";

const APP_URL = "https://mytenon.com";
const LEGACY = "tokenexchangeportal.vercel.app";

describe("canonical host redirect", () => {
  it("moves the alias hosts to the canonical domain", () => {
    expect(canonicalRedirect(LEGACY, "/", "", APP_URL)).toBe("https://mytenon.com/");
    expect(canonicalRedirect(LEGACY, "/pricing", "", APP_URL)).toBe("https://mytenon.com/pricing");
    expect(canonicalRedirect("www.mytenon.com", "/docs", "?tab=curl", APP_URL)).toBe("https://mytenon.com/docs?tab=curl");
  });

  it("reads the canonical host from APP_URL", () => {
    expect(canonicalRedirect(LEGACY, "/", "", "https://tenon.example/")).toBe("https://tenon.example/");
    expect(canonicalRedirect(LEGACY, "/", "", undefined)).toBe("https://mytenon.com/");
    expect(canonicalRedirect(LEGACY, "/", "", "not a url")).toBe("https://mytenon.com/");
  });

  it("self-disables while APP_URL still points at the alias", () => {
    expect(canonicalRedirect(LEGACY, "/", "", `https://${LEGACY}`)).toBeNull();
    expect(canonicalRedirect(LEGACY, "/pricing", "", `https://${LEGACY}/`)).toBeNull();
  });

  it("ignores case and the port on the host header", () => {
    expect(canonicalRedirect("TokenExchangePortal.Vercel.App:443", "/batch", "", APP_URL)).toBe("https://mytenon.com/batch");
  });

  it("leaves the canonical domain, preview deployments and local dev alone", () => {
    expect(canonicalRedirect("mytenon.com", "/", "", APP_URL)).toBeNull();
    expect(canonicalRedirect("tokenexchange-git-main-matthewhe22.vercel.app", "/", "", APP_URL)).toBeNull();
    expect(canonicalRedirect("localhost:3000", "/", "", APP_URL)).toBeNull();
    expect(canonicalRedirect(null, "/", "", APP_URL)).toBeNull();
  });

  it("never redirects API, webhook or OAuth callback paths", () => {
    for (const path of ["/v1", "/v1/chat/completions", "/v1beta/messages", "/api", "/api/stripe/webhook", "/api/auth/github/callback"]) {
      expect(canonicalRedirect(LEGACY, path, "", APP_URL)).toBeNull();
      expect(isMachinePath(path)).toBe(true);
    }
  });

  it("does not treat lookalike paths as machine paths", () => {
    expect(isMachinePath("/v1docs")).toBe(false);
    expect(canonicalRedirect(LEGACY, "/v1docs", "", APP_URL)).toBe("https://mytenon.com/v1docs");
  });

  it("parses hosts defensively", () => {
    expect(hostOf("https://mytenon.com")).toBe("mytenon.com");
    expect(hostOf("")).toBeNull();
    expect(hostOf(null)).toBeNull();
  });
});
