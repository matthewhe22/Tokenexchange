import { relay } from "@/relay/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Long generations stream for minutes. 300s is the Hobby ceiling; raise to 800 on Pro.
export const maxDuration = 300;

export function POST(req: Request) {
  return relay(req, "openai-responses", { endpoint: "/v1/responses" });
}
