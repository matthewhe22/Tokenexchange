// Plain constants (no drizzle imports) so client components can use them.
export const PROVIDERS = [
  "openai",
  "azure_openai",
  "openai_compatible",
  "anthropic",
  "anthropic_compatible",
  "bedrock",
  "vertex",
  "gemini",
] as const;
export type Provider = (typeof PROVIDERS)[number];

// How the capacity is procured: direct from the model vendor, through a cloud
// marketplace, or from a third-party reseller/relay.
export const SOURCES = ["official", "cloud", "reseller"] as const;
export type Source = (typeof SOURCES)[number];
