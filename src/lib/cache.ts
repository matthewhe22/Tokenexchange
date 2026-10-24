// Tiny per-instance TTL cache for hot config (channels, prices, settings). Admin edits
// take effect on every serverless instance within the TTL.
const store = new Map<string, { value: unknown; expiresAt: number }>();

export const CONFIG_TTL_MS = 10_000;

export async function cached<T>(key: string, loader: () => Promise<T>, ttlMs = CONFIG_TTL_MS): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await loader();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function invalidate(prefix?: string): void {
  if (!prefix) return store.clear();
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
