import { defineConfig } from "@playwright/test";

/**
 * Playwright config for visual regression testing against Storybook.
 *
 * Requires a built Storybook (`npm run build-storybook`) in storybook-static/.
 * Tests use `toHaveScreenshot()` to capture and compare component screenshots.
 */
export default defineConfig({
  testDir: "./visual-tests",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:6007",
    browserName: "chromium",
    screenshot: "off",
    // Consistent viewport for snapshot comparison
    viewport: { width: 1280, height: 720 },
  },
  // Start Storybook as a web server before tests
  webServer: {
    command: "npx http-server storybook-static --port 6007 --silent",
    port: 6007,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  expect: {
    toHaveScreenshot: {
      // Allow small anti-aliasing differences across environments
      maxDiffPixelRatio: 0.01,
    },
  },
});
