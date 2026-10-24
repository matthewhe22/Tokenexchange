import { cookies } from "next/headers";
import { safeNext } from "@/lib/login";

export const runtime = "nodejs";

// GET /api/lang?to=zh&back=/pricing — switches the site language and returns to the page.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const to = url.searchParams.get("to") === "zh" ? "zh" : "en";
  (await cookies()).set("lang", to, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return Response.redirect(new URL(safeNext(url.searchParams.get("back")) ?? "/", req.url), 302);
}
