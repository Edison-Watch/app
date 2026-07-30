import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Main-process tests run in node; renderer tests opt into jsdom with a
    // `@vitest-environment jsdom` docblock (they render React).
    include: ["src/main/__tests__/**/*.test.ts", "src/renderer/**/__tests__/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/main/**/*.ts"],
      exclude: ["src/main/__tests__/**"],
    },
  },
});
