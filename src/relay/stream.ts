import { waitUntil } from "@vercel/functions";

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
