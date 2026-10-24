import { eq, like, sql } from "drizzle-orm";
import Stripe from "stripe";
import { getDb, schema } from "@/db";
import { applyBalanceChange } from "./ledger";
import { appUrl } from "./url";

export const TOPUP_PRESETS_USD = [10, 25, 50, 100];
export const TOPUP_MIN_USD = 5;
export const TOPUP_MAX_USD = 2000;
const MICROS_PER_CENT = 10_000;

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

let client: Stripe | undefined;
export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!client) {
    // STRIPE_API_BASE points the SDK at a local mock in end-to-end tests.
    const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
    client = new Stripe(process.env.STRIPE_SECRET_KEY, {
      ...(base ? { host: base.hostname, port: Number(base.port), protocol: base.protocol.replace(":", "") as "http" | "https" } : {}),
    });
  }
  return client;
}

type User = typeof schema.users.$inferSelect;

/** Creates a Stripe Checkout session for a one-off credit purchase and returns its URL. */
export async function createTopupCheckout(user: User, amountUsd: number): Promise<string> {
  const cents = Math.round(amountUsd * 100);
  if (!(cents >= TOPUP_MIN_USD * 100 && cents <= TOPUP_MAX_USD * 100)) {
    throw new Error(`top-up must be between $${TOPUP_MIN_USD} and $${TOPUP_MAX_USD}`);
  }
  const stripe = getStripe();
  let customer = user.stripeCustomerId;
  if (!customer) {
    customer = (await stripe.customers.create({ email: user.email, metadata: { userId: String(user.id) } })).id;
    await getDb().update(schema.users).set({ stripeCustomerId: customer }).where(eq(schema.users.id, user.id));
  }
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer,
    client_reference_id: String(user.id),
    metadata: { userId: String(user.id) },
    line_items: [
      {
        quantity: 1,
        price_data: { currency: "usd", unit_amount: cents, product_data: { name: "TokenExchange API credit" } },
      },
    ],
    success_url: `${appUrl()}/dashboard/billing?status=success`,
    cancel_url: `${appUrl()}/dashboard/billing?status=cancelled`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

/** Applies a verified Stripe webhook event to user balances. Safe to call repeatedly with the same event. */
export async function handleStripeEvent(event: Stripe.Event): Promise<string> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object;
      if (s.mode !== "payment" || s.payment_status !== "paid") return `ignored: ${s.id} not paid yet`;
      const userId = Number(s.metadata?.userId ?? s.client_reference_id);
      if (!userId) return `ignored: ${s.id} has no user`;
      // Credit the pre-tax amount so enabling Stripe Tax later never inflates balances.
      const amount = (s.amount_subtotal ?? s.amount_total ?? 0) * MICROS_PER_CENT;
      const applied = await applyBalanceChange({
        userId,
        amount,
        type: "topup",
        reference: `stripe:${s.id}`,
        note: `Stripe top-up ${((s.amount_total ?? 0) / 100).toFixed(2)} ${s.currency?.toUpperCase()}`,
      });
      return applied ? `credited user ${userId}` : `duplicate: ${s.id}`;
    }
    case "charge.refunded": {
      const charge = event.data.object;
      const customer = typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
      if (!customer) return "ignored: refund without customer";
      const db = getDb();
      const [user] = await db.select().from(schema.users).where(eq(schema.users.stripeCustomerId, customer));
      if (!user) return `ignored: unknown customer ${customer}`;
      // amount_refunded is cumulative; debit only what has not been debited yet.
      const prefix = `stripe-refund:${charge.id}:`;
      const [{ debited }] = await db
        .select({ debited: sql<number>`coalesce(-sum(${schema.balanceTransactions.amount}), 0)::bigint` })
        .from(schema.balanceTransactions)
        .where(like(schema.balanceTransactions.reference, `${prefix}%`));
      const delta = charge.amount_refunded * MICROS_PER_CENT - Number(debited);
      if (delta <= 0) return "duplicate refund";
      await applyBalanceChange({
        userId: user.id,
        amount: -delta,
        type: "refund",
        reference: `${prefix}${charge.amount_refunded}`,
        note: `Stripe refund on ${charge.id}`,
      });
      return `debited user ${user.id}`;
    }
    default:
      return `ignored: ${event.type}`;
  }
}
