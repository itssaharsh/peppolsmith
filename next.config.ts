import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // API routes read the samples, declared partner config, recorded runs and VM scripts from disk at runtime.
  outputFileTracingIncludes: {
    "/api/**": ["./samples/**", "./config/**", "./public/replay/**", "./vm/**"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
