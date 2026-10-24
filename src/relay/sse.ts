/** Incremental Server-Sent Events parser. Feed it raw bytes; it calls back once per complete event. */
export class SSEParser {
  private buf = "";
  private decoder = new TextDecoder();

  constructor(private onEvent: (event: string | undefined, data: string) => void) {}

  push(chunk: Uint8Array): void {
    this.buf += this.decoder.decode(chunk, { stream: true });
    this.drain();
  }

  end(): void {
    this.buf += this.decoder.decode();
    if (this.buf.trim()) this.buf += "\n\n";
    this.drain();
  }

  private drain(): void {
    // A "\r" left at the end of the buffer is completed by the next chunk, so normalising here is safe.
    this.buf = this.buf.replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = this.buf.indexOf("\n\n")) !== -1) {
      const block = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      let event: string | undefined;
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length) this.onEvent(event, data.join("\n"));
    }
  }
}

export function encodeSSE(event: string | undefined, data: unknown): string {
  return (event ? `event: ${event}\n` : "") + `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}
