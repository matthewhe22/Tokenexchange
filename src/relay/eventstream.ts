// Decoder for the AWS event-stream binary framing used by Bedrock's *-with-response-stream APIs.
// Frame: total_len(u32) headers_len(u32) prelude_crc(u32) headers payload message_crc(u32)

export interface EventStreamMessage {
  headers: Record<string, string | number | boolean | Uint8Array>;
  payload: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function parseHeaders(bytes: Uint8Array): EventStreamMessage["headers"] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const out: EventStreamMessage["headers"] = {};
  let o = 0;
  while (o < bytes.length) {
    const nameLen = view.getUint8(o++);
    const name = dec.decode(bytes.subarray(o, o + nameLen));
    o += nameLen;
    const type = view.getUint8(o++);
    switch (type) {
      case 0: out[name] = true; break;
      case 1: out[name] = false; break;
      case 2: out[name] = view.getInt8(o); o += 1; break;
      case 3: out[name] = view.getInt16(o); o += 2; break;
      case 4: out[name] = view.getInt32(o); o += 4; break;
      case 5: out[name] = Number(view.getBigInt64(o)); o += 8; break;
      case 6: {
        const len = view.getUint16(o); o += 2;
        out[name] = bytes.slice(o, o + len); o += len;
        break;
      }
      case 7: {
        const len = view.getUint16(o); o += 2;
        out[name] = dec.decode(bytes.subarray(o, o + len)); o += len;
        break;
      }
      case 8: out[name] = Number(view.getBigInt64(o)); o += 8; break;
      case 9: out[name] = bytes.slice(o, o + 16); o += 16; break;
      default:
        throw new Error(`unknown event-stream header type ${type}`);
    }
  }
  return out;
}

export class EventStreamDecoder {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): EventStreamMessage[] {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;

    const messages: EventStreamMessage[] = [];
    while (this.buf.length >= 12) {
      const view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      const total = view.getUint32(0);
      const headersLen = view.getUint32(4);
      if (total < 16 || headersLen > total - 16) throw new Error("corrupt event-stream frame");
      if (view.getUint32(8) !== crc32(this.buf.subarray(0, 8))) throw new Error("event-stream prelude CRC mismatch");
      if (this.buf.length < total) break;
      const frame = this.buf.subarray(0, total);
      if (view.getUint32(total - 4) !== crc32(frame.subarray(0, total - 4))) {
        throw new Error("event-stream message CRC mismatch");
      }
      messages.push({
        headers: parseHeaders(frame.subarray(12, 12 + headersLen)),
        payload: frame.slice(12 + headersLen, total - 4),
      });
      this.buf = this.buf.slice(total);
    }
    return messages;
  }
}

/** Encodes a frame with string headers. Used by tests and the local mock upstream. */
export function encodeEventStreamMessage(headers: Record<string, string>, payload: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const hParts: number[] = [];
  for (const [k, v] of Object.entries(headers)) {
    const kb = enc.encode(k);
    const vb = enc.encode(v);
    hParts.push(kb.length, ...kb, 7, (vb.length >> 8) & 0xff, vb.length & 0xff, ...vb);
  }
  const hBytes = Uint8Array.from(hParts);
  const total = 12 + hBytes.length + payload.length + 4;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total);
  view.setUint32(4, hBytes.length);
  view.setUint32(8, crc32(out.subarray(0, 8)));
  out.set(hBytes, 12);
  out.set(payload, 12 + hBytes.length);
  view.setUint32(total - 4, crc32(out.subarray(0, total - 4)));
  return out;
}
