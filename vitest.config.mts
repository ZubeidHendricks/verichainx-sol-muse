import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // LiteSVM and PGlite tests take a few seconds each, more when the suite runs them side by side.
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 20_000 },
});
