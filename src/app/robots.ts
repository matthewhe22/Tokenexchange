import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Signed-in areas, machine endpoints and one-time links have nothing to index.
      disallow: ["/admin", "/dashboard", "/api/", "/v1/", "/v1beta/", "/login/2fa", "/reset-password", "/verify-email"],
    },
    sitemap: `${appUrl()}/sitemap.xml`,
    host: appUrl(),
  };
}
