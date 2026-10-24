import { headers } from "next/headers";

/** Caller IP. On Vercel `x-real-ip` is set by the platform and cannot be spoofed by the client. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "unknown";
}
