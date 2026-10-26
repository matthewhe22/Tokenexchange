import type { MetadataRoute } from "next";
import { GUIDES } from "@/lib/guides";
import { appUrl } from "@/lib/url";

// Rendered per request: prices (and so /, /pricing, /batch) change without a deploy.
export const dynamic = "force-dynamic";

const PAGES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; live?: boolean }[] = [
  { path: "/", priority: 1, changeFrequency: "daily", live: true },
  { path: "/pricing", priority: 0.9, changeFrequency: "daily", live: true },
  { path: "/batch", priority: 0.9, changeFrequency: "daily", live: true },
  { path: "/docs", priority: 0.8, changeFrequency: "weekly" },
  { path: "/guides", priority: 0.7, changeFrequency: "weekly" },
  { path: "/signup", priority: 0.6, changeFrequency: "monthly" },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();
  const built = process.env.BUILD_TIME ? new Date(process.env.BUILD_TIME) : new Date();
  const pages = PAGES.map((p) => ({
    url: `${base}${p.path === "/" ? "" : p.path}`,
    lastModified: p.live ? new Date() : built,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
  const guides = GUIDES.map((g) => ({
    url: `${base}/guides/${g.slug}`,
    lastModified: new Date(`${g.updated}T00:00:00Z`),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));
  return [...pages, ...guides];
}
