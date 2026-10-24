import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Relay responses are streamed straight through; never let Next buffer or compress them.
  compress: false,
  poweredByHeader: false,
};

export default nextConfig;
