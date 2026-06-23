import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "auth/index": "src/auth/index.ts",
    "crypto/index": "src/crypto/index.ts",
    "config/index": "src/config/index.ts",
    "ui/index": "src/ui/index.ts",
    "ui/Badge": "src/ui/Badge.tsx",
    "ui/Button": "src/ui/Button.tsx",
    "ui/Card": "src/ui/Card.tsx",
    "ui/Dialog": "src/ui/Dialog.tsx",
    "ui/Dropdown": "src/ui/Dropdown.tsx",
    "ui/EmptyState": "src/ui/EmptyState.tsx",
    "ui/ErrorBoundary": "src/ui/ErrorBoundary.tsx",
    "ui/Input": "src/ui/Input.tsx",
    "ui/Select": "src/ui/Select.tsx",
    "ui/Skeleton": "src/ui/Skeleton.tsx",
    "ui/SlideOver": "src/ui/SlideOver.tsx",
    "ui/SSEIndicator": "src/ui/SSEIndicator.tsx",
    "ui/Switch": "src/ui/Switch.tsx",
    "ui/Table": "src/ui/Table.tsx",
    "ui/Tabs": "src/ui/Tabs.tsx",
    "ui/Toast": "src/ui/Toast.tsx",
    "ui/Tooltip": "src/ui/Tooltip.tsx",
    "hooks/useAnimatedHeight": "src/hooks/useAnimatedHeight.ts",
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
