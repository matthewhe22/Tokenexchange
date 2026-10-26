import type { Metadata } from "next";

export const SITE_NAME = "Tenon";

// Setting openGraph on a page replaces the inherited object, so the share card is named again here.
const SHARE_IMAGE = { url: "/opengraph-image.png", width: 1200, height: 630, alt: "Tenon" };

/**
 * Metadata for a public page: its own description, a canonical URL (resolved against
 * metadataBase, so always on the canonical domain) and matching Open Graph / Twitter text.
 * `index: false` keeps utility pages (password reset, 2FA, …) out of search results.
 */
export function pageMetadata(opts: { path: string; title?: string; description: string; index?: boolean }): Metadata {
  const title = opts.title ? `${opts.title} · ${SITE_NAME}` : undefined;
  return {
    ...(opts.title ? { title: opts.title } : {}),
    description: opts.description,
    alternates: { canonical: opts.path },
    openGraph: { ...(title ? { title } : {}), description: opts.description, url: opts.path, siteName: SITE_NAME, type: "website", images: [SHARE_IMAGE] },
    twitter: { card: "summary_large_image", ...(title ? { title } : {}), description: opts.description, images: [SHARE_IMAGE.url] },
    ...(opts.index === false ? { robots: { index: false, follow: true } } : {}),
  };
}

/** Kept out of search engines entirely (signed-in areas). */
export const PRIVATE_METADATA: Metadata = { robots: { index: false, follow: false } };
