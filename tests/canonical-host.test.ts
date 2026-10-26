import { describe, expect, it } from "vitest";
import { CANONICAL_HOST, canonicalRedirect, isMachinePath } from "@/lib/canonical-host";

describe("canonical host redirect", () => {
  it("moves the Vercel production alias to the canonical domain", () => {
    expect(canonicalRedirect("tokenexchangeportal.vercel.app", "/")).toBe(`https://${CANONICAL_HOST}/`);
    expect(canonicalRedirect("tokenexchangeportal.vercel.app", "/pricing")).toBe(`https://${CANONICAL_HOST}/pricing`);
    expect(canonicalRedirect("www.mytenon.com", "/docs", "?tab=curl")).toBe(`https://${CANONICAL_HOST}/docs?tab=curl`);
  });

  it("ignores case and the port on the host header", () => {
    expect(canonicalRedirect("TokenExchangePortal.Vercel.App:443", "/batch")).toBe(`https://${CANONICAL_HOST}/batch`);
  });

  it("leaves the canonical domain, preview deployments and local dev alone", () => {
    expect(canonicalRedirect("mytenon.com", "/")).toBeNull();
    expect(canonicalRedirect("tokenexchange-git-main-matthewhe22.vercel.app", "/")).toBeNull();
    expect(canonicalRedirect("localhost:3000", "/")).toBeNull();
    expect(canonicalRedirect(null, "/")).toBeNull();
  });

  it("never redirects API or webhook paths, whatever host they arrive on", () => {
    for (const path of ["/v1", "/v1/chat/completions", "/v1beta/messages", "/api", "/api/stripe/webhook", "/api/auth/github/callback"]) {
      expect(canonicalRedirect("tokenexchangeportal.vercel.app", path)).toBeNull();
      expect(isMachinePath(path)).toBe(true);
    }
  });

  it("does not treat lookalike paths as machine paths", () => {
    expect(isMachinePath("/v1docs")).toBe(false);
    expect(canonicalRedirect("tokenexchangeportal.vercel.app", "/v1docs")).toBe(`https://${CANONICAL_HOST}/v1docs`);
  });
});
