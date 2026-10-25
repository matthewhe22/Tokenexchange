import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tenon",
    short_name: "Tenon",
    description: "One API key for every frontier model.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#F7F4F0",
    theme_color: "#2F211B",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
