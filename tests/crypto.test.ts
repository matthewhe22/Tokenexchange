import { beforeAll, describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/crypto";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("credential encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt('{"apiKey":"sk-1"}');
    expect(a).not.toBe(encrypt('{"apiKey":"sk-1"}'));
    expect(decrypt(a)).toBe('{"apiKey":"sk-1"}');
  });

  it("detects tampering", () => {
    const parts = encrypt("secret").split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
});
