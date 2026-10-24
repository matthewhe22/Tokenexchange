import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Relay responses are streamed straight through; never let Next buffer or compress them.
  compress: false,
  poweredByHeader: false,
  // Stamped at build time so the admin console can show when this version was deployed.
  env: {
    BUILD_TIME: new Date().toISOString(),
    BUILD_COMMIT: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7),
  },
};

export default nextConfig;
