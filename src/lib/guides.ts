// Guide articles: listed on /guides, in the sitemap, and in each guide's "more guides" footer.
export interface Guide {
  slug: string;
  title: string;
  description: string;
  /** ISO dates, for the page and its Article structured data. */
  published: string;
  updated: string;
}

export const GUIDES: Guide[] = [
  {
    slug: "openai-batch-api",
    title: "OpenAI Batch API tutorial: run LLM jobs at batch prices",
    description:
      "Step by step in Python: write a JSONL file, upload it, create a batch, poll it and read the results by custom_id. With batch prices, limits and a worked cost example.",
    published: "2026-10-26",
    updated: "2026-10-26",
  },
  {
    slug: "claude-code",
    title: "Use Claude Code with Tenon",
    description:
      "Point Claude Code at Tenon with two environment variables, choose the models it uses for each role, and make the setting permanent in settings.json.",
    published: "2026-10-26",
    updated: "2026-10-26",
  },
  {
    slug: "openai-compatible",
    title: "Use any OpenAI-compatible app or SDK with Tenon",
    description:
      "Change the base URL and API key in the OpenAI Python and Node SDKs, LangChain, the Vercel AI SDK, or any tool with an OpenAI-compatible setting, then list models and stream replies.",
    published: "2026-10-26",
    updated: "2026-10-26",
  },
];

export function guide(slug: string): Guide {
  const g = GUIDES.find((x) => x.slug === slug);
  if (!g) throw new Error(`unknown guide ${slug}`);
  return g;
}
