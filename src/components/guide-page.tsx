import Link from "next/link";
import type { ReactNode } from "react";
import { GUIDES, guide } from "@/lib/guides";
import { pageMetadata } from "@/lib/seo";
import { appUrl } from "@/lib/url";
import { JsonLd } from "./json-ld";

export function guideMetadata(slug: string) {
  const g = guide(slug);
  return pageMetadata({ path: `/guides/${slug}`, title: g.title, description: g.description });
}

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** Article frame: title, date, Article structured data, and links to the other guides. */
export function GuidePage({ slug, children }: { slug: string; children: ReactNode }) {
  const g = guide(slug);
  const base = appUrl();
  const url = `${base}/guides/${slug}`;
  const org = { "@type": "Organization", name: "Tenon", url: base };
  return (
    <article className="site-inner section prose guide">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "TechArticle",
            headline: g.title,
            description: g.description,
            datePublished: g.published,
            dateModified: g.updated,
            author: org,
            publisher: org,
            mainEntityOfPage: url,
            image: `${base}/opengraph-image.png`,
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Guides", item: `${base}/guides` },
              { "@type": "ListItem", position: 2, name: g.title, item: url },
            ],
          },
        ]}
      />
      <p className="muted" style={{ fontSize: 13 }}>
        <Link href="/guides">Guides</Link> · Updated <time dateTime={g.updated}>{longDate(g.updated)}</time>
      </p>
      <h1 className="page-title">{g.title}</h1>
      <p className="lead">{g.description}</p>
      {children}
      <hr />
      <h2>More guides</h2>
      <ul>
        {GUIDES.filter((x) => x.slug !== slug).map((x) => (
          <li key={x.slug}><Link href={`/guides/${x.slug}`}>{x.title}</Link></li>
        ))}
        <li><Link href="/docs">API documentation</Link></li>
      </ul>
    </article>
  );
}
