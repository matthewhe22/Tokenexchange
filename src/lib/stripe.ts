import { eq, like, sql } from "drizzle-orm";
import Stripe from "stripe";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
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
  const newCustomer = async () => {
    const id = (await stripe.customers.create({ email: user.email, metadata: { userId: String(user.id) } })).id;
    await getDb().update(schema.users).set({ stripeCustomerId: id }).where(eq(schema.users.id, user.id));
    return id;
  };
  const customer = user.stripeCustomerId ?? (await newCustomer());
  try {
    return await checkoutUrl(stripe, user, customer, cents);
  } catch (err) {
    // The stored customer belongs to the other mode (test vs live keys) or was deleted in Stripe:
    // start a new one rather than leaving the user unable to pay.
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing" && err.param === "customer") {
      return checkoutUrl(stripe, user, await newCustomer(), cents);
    }
    throw err;
  }
}

async function checkoutUrl(stripe: Stripe, user: User, customer: string, cents: number): Promise<string> {
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

/** Audit-log actor for changes made by Stripe webhooks. */
const STRIPE_ACTOR = { id: 0, email: "stripe-webhook" };

const chargeId = (c: string | Stripe.Charge) => (typeof c === "string" ? c : c.id);

/** The user who paid a charge, looked up by the charge's Stripe customer. */
async function userForCharge(charge: string | Stripe.Charge): Promise<User | null> {
  const c = typeof charge === "string" ? await getStripe().charges.retrieve(charge) : charge;
  const customer = typeof c.customer === "string" ? c.customer : c.customer?.id;
  if (!customer) return null;
  const [user] = await getDb().select().from(schema.users).where(eq(schema.users.stripeCustomerId, customer));
  return user ?? null;
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
    case "charge.dispute.created": {
      // A chargeback: the money is gone (plus Stripe's dispute fee). Take the credit back, which
      // may leave a negative balance if it was already spent, and lock the account for review.
      const dispute = event.data.object;
      const user = await userForCharge(dispute.charge);
      if (!user) return `ignored: dispute ${dispute.id} on a charge with no known customer`;
      const applied = await applyBalanceChange({
        userId: user.id,
        amount: -dispute.amount * MICROS_PER_CENT,
        type: "dispute",
        reference: `stripe-dispute:${dispute.id}`,
        note: `Stripe dispute ${dispute.id} (${dispute.reason}) on ${chargeId(dispute.charge)}`,
      });
      if (!applied) return `duplicate: ${dispute.id}`;
      // Disabling blocks the console and every API key; bumping the session version signs the user out.
      await getDb()
        .update(schema.users)
        .set({ disabled: true, sessionVersion: sql`${schema.users.sessionVersion} + 1` })
        .where(eq(schema.users.id, user.id));
      await audit(STRIPE_ACTOR, "stripe.dispute_opened", `user:${user.id}`, {
        dispute: dispute.id,
        charge: chargeId(dispute.charge),
        amountCents: dispute.amount,
        reason: dispute.reason,
      });
      return `debited and disabled user ${user.id}`;
    }
    case "charge.dispute.closed": {
      // Won: the funds come back, so restore the credit. The account stays disabled until an admin
      // re-enables it.
      const dispute = event.data.object;
      if (dispute.status !== "won") return `dispute ${dispute.id} closed: ${dispute.status}`;
      const user = await userForCharge(dispute.charge);
      if (!user) return `ignored: dispute ${dispute.id} on a charge with no known customer`;
      const applied = await applyBalanceChange({
        userId: user.id,
        amount: dispute.amount * MICROS_PER_CENT,
        type: "dispute",
        reference: `stripe-dispute-won:${dispute.id}`,
        note: `Stripe dispute ${dispute.id} won`,
      });
      if (applied) await audit(STRIPE_ACTOR, "stripe.dispute_won", `user:${user.id}`, { dispute: dispute.id, amountCents: dispute.amount });
      return applied ? `re-credited user ${user.id}` : `duplicate: ${dispute.id}`;
    }
    default:
      return `ignored: ${event.type}`;
  }
}
