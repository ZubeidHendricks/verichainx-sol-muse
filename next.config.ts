import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The local demo and the browser test run next to a devnet dev server, so they build into their own folder.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  cacheComponents: true,
  // PGlite loads its WASM build from node_modules at runtime; LiteSVM (local demo only) is a native addon.
  serverExternalPackages: ["@electric-sql/pglite", "litesvm"],
  partialPrefetching: true,
  // Read from disk at runtime: migrations on first open, and the demo shops' photos for the photo check.
  outputFileTracingIncludes: { "/**": ["./drizzle/**", "./public/demo/**"] },
};

export default nextConfig;
