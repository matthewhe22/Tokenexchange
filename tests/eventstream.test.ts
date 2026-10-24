import { describe, expect, it } from "vitest";
import { bedrockToSSE } from "@/relay/bedrock-stream";
import { crc32, encodeEventStreamMessage, EventStreamDecoder } from "@/relay/eventstream";

const enc = new TextEncoder();

function chunkFrame(event: object) {
  const payload = enc.encode(JSON.stringify({ bytes: Buffer.from(JSON.stringify(event)).toString("base64") }));
  return encodeEventStreamMessage({ ":message-type": "event", ":event-type": "chunk", ":content-type": "application/json" }, payload);
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("EventStreamDecoder", () => {
  it("decodes frames split across arbitrary chunk boundaries", () => {
    const a = chunkFrame({ type: "message_start" });
    const b = chunkFrame({ type: "message_stop" });
    const all = new Uint8Array([...a, ...b]);
    const dec = new EventStreamDecoder();
    const out = [];
    for (let i = 0; i < all.length; i += 7) out.push(...dec.push(all.subarray(i, i + 7)));
    expect(out).toHaveLength(2);
    expect(out[0].headers[":event-type"]).toBe("chunk");
  });

  it("rejects corrupted frames", () => {
    const f = chunkFrame({ type: "x" });
    f[f.length - 6] ^= 0xff;
    expect(() => new EventStreamDecoder().push(f)).toThrow(/CRC/);
  });
});

describe("bedrockToSSE", () => {
  it("unwraps chunk payloads into Anthropic SSE events", async () => {
    const frames = [chunkFrame({ type: "message_start", message: { usage: { input_tokens: 5 } } }), chunkFrame({ type: "message_stop" })];
    const src = new ReadableStream<Uint8Array>({
      start(c) {
        frames.forEach((f) => c.enqueue(f));
        c.close();
      },
    });
    const text = await new Response(src.pipeThrough(bedrockToSSE())).text();
    expect(text).toContain("event: message_start\ndata: {");
    expect(text).toContain("event: message_stop");
  });
});
