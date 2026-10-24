import { timingSafeEqual } from "node:crypto";
import { releaseStaleReservations } from "@/lib/reservations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(header: string | null, secret: string): boolean {
  const a = Buffer.from(header ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET is not set; stale reservations are only released opportunistically");
    return new Response("cron not configured", { status: 503 });
  }
  if (!authorized(req.headers.get("authorization"), secret)) return new Response("unauthorized", { status: 401 });
  return Response.json({ released: await releaseStaleReservations() });
}
