import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, totpCode, verifyTotp } from "@/lib/totp";

// RFC 6238 Appendix B test secret ("12345678901234567890") and SHA-1 vectors (last 6 digits).
const SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("round-trips base32", () => {
    expect(base32Decode(SECRET).toString()).toBe("12345678901234567890");
  });
  it("matches the RFC 6238 vectors", () => {
    expect(totpCode(SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(totpCode(SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpCode(SECRET, Math.floor(1234567890 / 30))).toBe("005924");
    expect(totpCode(SECRET, Math.floor(2000000000 / 30))).toBe("279037");
  });
  it("accepts ±1 step and rejects replays", () => {
    const now = 1234567890_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(SECRET, totpCode(SECRET, step), null, now)).toBe(step);
    expect(verifyTotp(SECRET, totpCode(SECRET, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(SECRET, totpCode(SECRET, step - 2), null, now)).toBeNull();
    expect(verifyTotp(SECRET, totpCode(SECRET, step), step, now)).toBeNull();
    expect(verifyTotp(SECRET, "12345", null, now)).toBeNull();
  });
});
