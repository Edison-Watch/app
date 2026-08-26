import { test, expect } from "./fixtures";

/**
 * Live end-to-end test of the device-authorization login against a real
 * SealGate backend (the same grant the dashboard's /device page approves).
 *
 * Opt-in: requires a running backend with a seeded admin key, e.g. the
 * cloud-sandbox / goose-e2e stack from the sealgate repo:
 *
 *   SEALGATE_E2E_BACKEND=http://127.0.0.1:3001 \
 *   SEALGATE_E2E_ADMIN_KEY=sealgate_local_admin_key \
 *   npx playwright test e2e/device-login.spec.ts
 *
 * The test clicks "Sign in with your browser", reads the user code from the
 * waiting panel, approves the request via the backend API (standing in for
 * the human on the dashboard /device page), and asserts the app lands in the
 * signed-in state with a working API key.
 */

const BACKEND = process.env.SEALGATE_E2E_BACKEND ?? "";
const ADMIN_KEY = process.env.SEALGATE_E2E_ADMIN_KEY ?? "sealgate_local_admin_key";

test.describe("Device-authorization login (live backend)", () => {
  test.skip(!BACKEND, "SEALGATE_E2E_BACKEND not set - skipping live login test");

  test("full sign-in via device grant approval", async ({ firstWindow }) => {
    const signInButton = firstWindow.getByRole("button", { name: "Sign in with your browser" });
    await expect(signInButton).toBeVisible({ timeout: 30000 });
    await signInButton.click();

    // The waiting panel shows the human verification code.
    const codeLocator = firstWindow.getByTestId("device-user-code");
    await expect(codeLocator).toBeVisible({ timeout: 15000 });
    const userCode = (await codeLocator.textContent())?.trim() ?? "";
    expect(userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    await firstWindow.screenshot({ path: "test-results/device-login-waiting.png" });

    // Approve the grant as the signed-in human would on the dashboard.
    const approve = await fetch(
      `${BACKEND}/api/v1/auth/device/requests/${encodeURIComponent(userCode)}/approve`,
      { method: "POST", headers: { Authorization: `Bearer ${ADMIN_KEY}` } },
    );
    expect(approve.status).toBe(200);
    expect((await approve.json()).status).toBe("approved");

    // The app polls the token endpoint (7s interval) and completes sign-in.
    await expect(firstWindow.getByText("Authenticated")).toBeVisible({ timeout: 60000 });
    await expect(firstWindow.getByRole("button", { name: "Continue" })).toBeEnabled();
    await firstWindow.screenshot({ path: "test-results/device-login-signed-in.png" });

    // The stored session must carry both credentials.
    const stored = await firstWindow.evaluate(() => {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith("sealgate_device_session:")) {
          return JSON.parse(localStorage.getItem(key) ?? "null");
        }
      }
      return null;
    });
    expect(stored?.apiKey).toBeTruthy();
    expect(stored?.clientAccessToken).toMatch(/^ewc_/);

    // The API key must actually authenticate against the backend.
    const profile = await fetch(`${BACKEND}/api/v1/user/profile`, {
      headers: { Authorization: `Bearer ${stored.apiKey}` },
    });
    expect(profile.status).toBe(200);
  });
});
