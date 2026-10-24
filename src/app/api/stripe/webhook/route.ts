import { getStripe, handleStripeEvent } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return new Response("webhook not configured", { status: 400 });

  let event;
  try {
    event = await getStripe().webhooks.constructEventAsync(await req.text(), signature, secret);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }
  try {
    const result = await handleStripeEvent(event);
    return Response.json({ received: true, result });
  } catch (err) {
    console.error("stripe webhook failed", event.id, err);
    // Non-2xx makes Stripe retry later; crediting is idempotent so retries are safe.
    return new Response("processing failed", { status: 500 });
  }
}
