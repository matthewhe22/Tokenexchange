import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { PROVIDERS, SOURCES, type Provider, type Source } from "./enums";

// All money columns are integer micro-USD: 1 USD = 1_000_000.
// A price of $X per 1M tokens therefore costs exactly X micro-USD per token.

// Customer tiers (e.g. "wholesale", "vip"): every price for members is multiplied by `multiplier`.
export const pricingGroups = pgTable("pricing_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  multiplier: doublePrecision("multiplier").notNull().default(1),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  balance: bigint("balance", { mode: "number" }).notNull().default(0),
  disabled: boolean("disabled").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  // Bumped on password change/reset; sessions signed with an older version are rejected.
  sessionVersion: integer("session_version").notNull().default(0),
  groupId: integer("group_id").references(() => pricingGroups.id, { onDelete: "set null" }),
  // TOTP two-factor auth. The secret is encrypted; it is enabled only once a code has been confirmed.
  totpSecret: text("totp_secret"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  // Last accepted 30-second step, so a code cannot be replayed.
  totpLastStep: bigint("totp_last_step", { mode: "number" }),
  // Send a low-balance email when the balance falls below this (micro-USD); null = site default, 0 = off.
  lowBalanceThreshold: bigint("low_balance_threshold", { mode: "number" }),
  lowBalanceNotifiedAt: timestamp("low_balance_notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    keyPrefix: text("key_prefix").notNull(),
    // null = all priced models allowed
    allowedModels: text("allowed_models").array(),
    // null = no per-key limit (user balance still applies)
    quotaLimit: bigint("quota_limit", { mode: "number" }),
    used: bigint("used", { mode: "number" }).notNull().default(0),
    // requests per minute; null = use the site default
    rpmLimit: integer("rpm_limit"),
    enabled: boolean("enabled").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_keys_user_idx").on(t.userId)],
);

export { PROVIDERS, SOURCES, type Provider, type Source };

export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider", { enum: PROVIDERS }).notNull(),
  source: text("source", { enum: SOURCES }).notNull(),
  // Overrides the provider's default endpoint (required for *_compatible).
  baseUrl: text("base_url"),
  // Non-secret provider settings, e.g. { region } for Bedrock, { projectId, location } for Vertex.
  config: jsonb("config").$type<Record<string, string>>().notNull().default({}),
  // AES-256-GCM encrypted JSON of the provider credentials.
  credentials: text("credentials").notNull(),
  models: text("models").array().notNull().default([]),
  // public model name -> upstream model id / deployment name
  modelMapping: jsonb("model_mapping").$type<Record<string, string>>().notNull().default({}),
  priority: integer("priority").notNull().default(0),
  weight: integer("weight").notNull().default(1),
  // What this channel costs us relative to list price (0.8 = we pay 80%). Used for margin reports.
  costMultiplier: doublePrecision("cost_multiplier").notNull().default(1),
  enabled: boolean("enabled").notNull().default(true),
  failCount: integer("fail_count").notNull().default(0),
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  // Set when the gateway (not an admin) disabled the channel; such channels are probed and re-enabled.
  autoDisabledAt: timestamp("auto_disabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Official list prices in USD per 1M tokens. Customer price = list x markup;
// our cost = list x channel.costMultiplier.
export const modelPrices = pgTable("model_prices", {
  model: text("model").primaryKey(),
  inputPrice: doublePrecision("input_price").notNull(),
  outputPrice: doublePrecision("output_price").notNull(),
  cacheReadPrice: doublePrecision("cache_read_price"),
  cacheWritePrice: doublePrecision("cache_write_price"),
  markup: doublePrecision("markup").notNull().default(1),
  // Largest output the model can produce; caps requests that set no limit (null = MAX_OUTPUT default).
  maxOutputTokens: integer("max_output_tokens"),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

export const usageLogs = pgTable(
  "usage_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id").notNull(),
    apiKeyId: integer("api_key_id").notNull(),
    channelId: integer("channel_id"),
    endpoint: text("endpoint").notNull(),
    model: text("model").notNull(),
    upstreamModel: text("upstream_model"),
    stream: boolean("stream").notNull().default(false),
    status: integer("status").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    // what we charged the customer
    cost: bigint("cost", { mode: "number" }).notNull().default(0),
    // estimated upstream cost (list price x channel cost multiplier)
    upstreamCost: bigint("upstream_cost", { mode: "number" }).notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_logs_user_idx").on(t.userId, t.createdAt), index("usage_logs_created_idx").on(t.createdAt)],
);

export const balanceTransactions = pgTable("balance_transactions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  amount: bigint("amount", { mode: "number" }).notNull(),
  type: text("type", { enum: ["topup", "adjust", "refund"] }).notNull(),
  // e.g. Stripe checkout session id; unique so payment webhooks are idempotent
  reference: text("reference").unique(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One-time tokens for email verification and password reset. Only the hash is stored.
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: ["verify_email", "reset_password"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_tokens_user_idx").on(t.userId)],
);

// Funds held while a request is in flight, so concurrent requests cannot overdraw a balance.
// Settling a request deletes its row; rows left behind by killed functions are released by cron.
export const reservations = pgTable(
  "reservations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    apiKeyId: integer("api_key_id"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reservations_created_idx").on(t.createdAt)],
);

// Fixed-window counters for rate limiting when Upstash Redis is not configured.
export const rateLimits = pgTable("rate_limits", {
  bucket: text("bucket").primaryKey(),
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
  count: integer("count").notNull(),
});

// Who changed what in the admin console. Credentials are never written here.
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: integer("actor_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    target: text("target"),
    details: jsonb("details"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_created_idx").on(t.createdAt)],
);
