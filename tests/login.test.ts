import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/login";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/admin")).toBe("/admin");
    expect(safeNext("/dashboard/keys?x=1#y")).toBe("/dashboard/keys?x=1#y");
  });
  it("rejects anything that can leave the site", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com", "evil.com", "", null, undefined]) {
      expect(safeNext(bad as string)).toBeNull();
    }
  });
});
