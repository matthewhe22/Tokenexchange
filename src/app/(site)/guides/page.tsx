import Link from "next/link";
import { GUIDES } from "@/lib/guides";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/guides",
  title: "Guides",
  description: "Hands-on guides for Tenon: the OpenAI Batch API, Claude Code, and moving any OpenAI-compatible app or SDK over by changing its base URL.",
});

export default function GuidesPage() {
  return (
    <div className="site-inner section prose">
      <h1 className="page-title">Guides</h1>
      <p className="muted">Walkthroughs for common jobs. For the full API reference, see the <Link href="/docs">docs</Link>.</p>
      <div className="guide-list">
        {GUIDES.map((g) => (
          <Link key={g.slug} href={`/guides/${g.slug}`} className="card guide-card">
            <h2>{g.title}</h2>
            <p className="muted">{g.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
