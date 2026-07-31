import { test as base, expect, type ElectronApplication, _electron as electron } from "@playwright/test";
import { join } from "path";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";

/**
 * Live end-to-end test of the custom (self-hosted) backend option: connect
 * the app to a backend by URL from the welcome screen, then complete the
 * device-authorization login against it.
 *
 * Opt-in, same stack as device-login.spec.ts:
 *
 *   EDISON_E2E_BACKEND=http://127.0.0.1:3001 \
 *   EDISON_E2E_ADMIN_KEY=edison_local_admin_key \
 *   npx playwright test e2e/custom-backend-login.spec.ts
 *
 * Unlike device-login.spec.ts - which relies on the dev build's localhost
 * default - this test proves the app reaches an arbitrary URL: the "dev"
 * default is overridden to the demo backend first, so a pass is only
 * possible if the custom-URL machinery actually repoints every call.
 */

const BACKEND = process.env.EDISON_E2E_BACKEND ?? "";
const ADMIN_KEY = process.env.EDISON_E2E_ADMIN_KEY ?? "edison_local_admin_key";

const test = base.extend<{ electronApp: ElectronApplication; userDataDir: string }>({
  // eslint-disable-next-line no-empty-pattern
  userDataDir: async ({}, use) => {
    await use(mkdtempSync(join(tmpdir(), "edison-e2e-custom-")));
  },
  electronApp: async ({ userDataDir }, use) => {
    // Start on the demo env, NOT the unpackaged default ("dev" = localhost):
    // if the custom URL were ignored, the app would talk to the demo backend
    // and every assertion below would fail rather than silently pass.
    writeFileSync(join(userDataDir, "edison_debug_env.json"), JSON.stringify({ env: "demo" }));
    const app = await electron.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-features=VizDisplayCompositor",
        `--user-data-dir=${userDataDir}`,
        join(__dirname, "../out/main/index.js"),
      ],
      env: { ...process.env, NODE_ENV: "test", EDISON_TEST_MODE: "1" },
    });
    await use(app);
    await app.close();
  },
});

test.describe("Custom backend (self-hosted) login", () => {
  test.skip(!BACKEND, "EDISON_E2E_BACKEND not set - skipping live custom-backend test");

  test("connect by URL from the welcome screen, then sign in", async ({ electronApp }) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // Open the self-hosted connect form and point the app at the backend.
    const connectLink = window.getByRole("button", {
      name: "Using a self-hosted Edison server? Connect by URL",
    });
    await expect(connectLink).toBeVisible({ timeout: 30000 });
    await connectLink.click();
    await window.getByTestId("custom-server-url-input").fill(BACKEND);
    await window.getByTestId("custom-server-connect").click();

    // The main process persists the URL, broadcasts env:changed and the
    // renderer reloads into the "custom" environment.
    await expect(window.getByText(`Server:`)).toBeVisible({ timeout: 30000 });
    await expect(window.getByText(BACKEND.replace(/\/$/, ""))).toBeVisible();
    await window.screenshot({ path: "test-results/custom-backend-connected.png" });

    // Standard device-grant dance - but against the custom origin.
    await window.getByRole("button", { name: "Sign in with your browser" }).click();
    const codeLocator = window.getByTestId("device-user-code");
    await expect(codeLocator).toBeVisible({ timeout: 15000 });
    const userCode = (await codeLocator.textContent())?.trim() ?? "";
    expect(userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    // Approve on the target backend. If the app had requested the grant from
    // any other origin, this approval would not match and sign-in would hang.
    const approve = await fetch(
      `${BACKEND}/api/v1/auth/device/requests/${encodeURIComponent(userCode)}/approve`,
      { method: "POST", headers: { Authorization: `Bearer ${ADMIN_KEY}` } },
    );
    expect(approve.status).toBe(200);

    await expect(window.getByText("Authenticated")).toBeVisible({ timeout: 60000 });
    await window.screenshot({ path: "test-results/custom-backend-signed-in.png" });

    // The stored session lives under the "custom" env key and its API key
    // must authenticate against the custom backend.
    const stored = await window.evaluate(() =>
      JSON.parse(localStorage.getItem("edison_device_session:custom") ?? "null"),
    );
    expect(stored?.apiKey).toBeTruthy();
    const profile = await fetch(`${BACKEND}/api/v1/user/profile`, {
      headers: { Authorization: `Bearer ${stored.apiKey}` },
    });
    expect(profile.status).toBe(200);
  });
});

export { expect };
