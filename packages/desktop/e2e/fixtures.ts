import { test as base, type ElectronApplication, type Page, _electron as electron } from "@playwright/test";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

/**
 * Custom test fixture that launches the Electron app and provides
 * the ElectronApplication and first window Page.
 *
 * Expects the app to be built first via `npm run build` (electron-vite build).
 * In CI, set EDISON_TEST_MODE=1 to skip real auth and backend calls.
 */
export const test = base.extend<{
  electronApp: ElectronApplication;
  firstWindow: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    const mainPath = join(__dirname, "../out/main/index.js");
    // Fresh profile per test so a machine where setup already completed still
    // exercises the wizard.
    const userDataDir = mkdtempSync(join(tmpdir(), "edison-e2e-"));

    const app = await electron.launch({
      args: [
        // Chromium/Electron switches must come BEFORE the app path so the
        // command-line parser treats them as switches, not process.argv.
        // Sandbox/GPU flags keep Electron alive on headless CI runners.
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-features=VizDisplayCompositor",
        `--user-data-dir=${userDataDir}`,
        mainPath,
      ],
      env: {
        ...process.env,
        NODE_ENV: "test",
        EDISON_TEST_MODE: "1",
      },
    });

    await use(app);
    await app.close();
  },

  firstWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    // Wait for the renderer to fully load
    await window.waitForLoadState("domcontentloaded");
    await use(window);
  },
});

export { expect } from "@playwright/test";
