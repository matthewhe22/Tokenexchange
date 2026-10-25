import { waitUntil } from "@vercel/functions";

export function finalizeStream(
  source: ReadableStream<Uint8Array>,
  unmetered: () => boolean,
  tail: () => string,
  message: () => string,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (!done) {
        controller.enqueue(value);
        return;
      }
      if (!unmetered()) {
        controller.close();
        return;
      }
      // The upstream never told us what it charged, so the response cannot be trusted: emit the
      // protocol's error event and then error the stream, so the caller's SDK fails loudly.
      controller.enqueue(encoder.encode(tail()));
      controller.error(new Error(message()));
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/**
 * Pass `source` through to the client while observing every chunk. `onEnd` runs exactly once,
 * after the upstream stream is fully consumed. If the client disconnects early we keep draining
 * upstream in the background so the request is still billed for what the provider charged us.
 */
export function tapStream(
  source: ReadableStream<Uint8Array>,
  onChunk: (chunk: Uint8Array) => void,
  onEnd: (error?: unknown) => Promise<void>,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let ended = false;
  const end = (error?: unknown) => {
    if (ended) return;
    ended = true;
    waitUntil(onEnd(error).catch((e) => console.error("stream onEnd failed", e)));
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          end();
          return;
        }
        onChunk(value);
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
        end(err);
      }
    },
    cancel() {
      waitUntil(
        (async () => {
          let error: unknown;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              onChunk(value);
            }
          } catch (err) {
            error = err;
          }
          end(error ?? "client disconnected");
        })(),
      );
    },
  });
}
