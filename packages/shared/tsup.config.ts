import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "auth/index": "src/auth/index.ts",
    "crypto/index": "src/crypto/index.ts",
    "config/index": "src/config/index.ts",
    "ui/index": "src/ui/index.ts",
    "agent-registry/index": "src/agent-registry/index.ts",
    "animations/index": "src/animations/index.ts",
    "svg/index": "src/svg/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  clean: true,
  outDir: "dist",
  esbuildOptions(options, context) {
    if (context.format === "cjs") {
      // CommonJS has no import.meta; source code falls back when Vite env vars are absent.
      options.define = { ...options.define, "import.meta.env": "{}" };
    }
  },
});
