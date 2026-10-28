import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // PGlite loads its WASM build from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  partialPrefetching: true,
};

export default nextConfig;
