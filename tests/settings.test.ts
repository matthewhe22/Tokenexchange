import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTING, DEFAULT_LIMITS } from "@/lib/settings";

describe("default settings", () => {
  it("routes from cloud capacity only, so vendor APIs are never resold by accident", () => {
    // Bedrock / Vertex / Azure are bought under a partner programme; the vendors' own APIs forbid
    // reselling account access, so a fresh install must not serve them until an admin opts in.
    expect(DEFAULT_ROUTING.enabledSources).toEqual(["cloud"]);
  });

  it("has no per-key or per-user request limit until an admin sets one", () => {
    expect(DEFAULT_LIMITS).toEqual({ defaultKeyRpm: 0, userRpm: 0 });
  });
});
