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

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  balance: bigint("balance", { mode: "number" }).notNull().default(0),
  disabled: boolean("disabled").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
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
