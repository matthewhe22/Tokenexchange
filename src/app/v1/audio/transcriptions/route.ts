import { relay } from "@/relay/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function POST(req: Request) {
  return relay(req, "openai-audio-transcriptions", { endpoint: "/v1/audio/transcriptions", multipart: true });
}
