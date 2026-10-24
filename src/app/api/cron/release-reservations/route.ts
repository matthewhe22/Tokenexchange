import { releaseStaleReservations } from "@/lib/reservations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  return Response.json({ released: await releaseStaleReservations() });
}
