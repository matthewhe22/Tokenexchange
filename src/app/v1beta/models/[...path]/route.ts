import { relay } from "@/relay/handler";
import { relayError } from "@/relay/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Gemini puts the model and action in the path: /v1beta/models/{model}:{generateContent|streamGenerateContent}
export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const last = decodeURIComponent(path.join("/"));
  const sep = last.lastIndexOf(":");
  const model = sep === -1 ? "" : last.slice(0, sep);
  const action = sep === -1 ? "" : last.slice(sep + 1);
  if (!model || (action !== "generateContent" && action !== "streamGenerateContent")) {
    return relayError("gemini", 404, `unsupported Gemini method '${last}'`);
  }
  return relay(req, "gemini", { model, stream: action === "streamGenerateContent", endpoint: `/v1beta/models:${action}` });
}
