import { test, expect } from "@playwright/test";

/**
 * Visual regression tests for all shared UI components.
 *
 * Each test navigates to a Storybook story via the iframe URL and captures
 * a screenshot using Playwright's `toHaveScreenshot()`. On first run, baseline
 * snapshots are created. On subsequent runs, screenshots are compared against
 * the baselines and any visual differences are flagged.
 *
 * Requires: `npm run build-storybook` before running.
 */

// Storybook iframe URL pattern: /iframe.html?id=<storyId>&viewMode=story
const storyUrl = (id: string) =>
  `/iframe.html?id=${id}&viewMode=story&globals=backgrounds.value:!hex(0B0E14)`;

// Wait for Storybook story to render
async function waitForStory(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle");
  // Wait for the storybook root to have content
  await page.waitForSelector("#storybook-root > *", { timeout: 10_000 });
  // Extra settle time for CSS transitions / animations
  await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
test.describe("Badge", () => {
  test("all variants", async ({ page }) => {
    await page.goto(storyUrl("ui-badge--all-variants"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("badge-all-variants.png");
  });

  test("all sizes", async ({ page }) => {
    await page.goto(storyUrl("ui-badge--all-sizes"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("badge-all-sizes.png");
  });
});

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
test.describe("Button", () => {
  test("all variants", async ({ page }) => {
    await page.goto(storyUrl("ui-button--all-variants"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("button-all-variants.png");
  });

  test("all sizes", async ({ page }) => {
    await page.goto(storyUrl("ui-button--all-sizes"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("button-all-sizes.png");
  });

  test("loading variants", async ({ page }) => {
    await page.goto(storyUrl("ui-button--loading-variants"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("button-loading-variants.png");
  });

  test("disabled variants", async ({ page }) => {
    await page.goto(storyUrl("ui-button--disabled-variants"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("button-disabled-variants.png");
  });
});

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
test.describe("Card", () => {
  test("default", async ({ page }) => {
    await page.goto(storyUrl("ui-card--default"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("card-default.png");
  });

  test("with header and footer", async ({ page }) => {
    await page.goto(storyUrl("ui-card--with-header-and-footer"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("card-with-header-and-footer.png");
  });
});

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------
test.describe("Dialog", () => {
  test("open by default", async ({ page }) => {
    await page.goto(storyUrl("ui-dialog--open-by-default"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("dialog-open.png");
  });
});

// ---------------------------------------------------------------------------
// Dropdown
// ---------------------------------------------------------------------------
test.describe("Dropdown", () => {
  test("default", async ({ page }) => {
    await page.goto(storyUrl("ui-dropdown--default"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("dropdown-default.png");
  });
});

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------
test.describe("EmptyState", () => {
  test("with action", async ({ page }) => {
    await page.goto(storyUrl("ui-emptystate--with-action"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("emptystate-with-action.png");
  });
});

// ---------------------------------------------------------------------------
// ErrorBoundary
// ---------------------------------------------------------------------------
test.describe("ErrorBoundary", () => {
  test("with error", async ({ page }) => {
    await page.goto(storyUrl("ui-errorboundary--with-error"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("errorboundary-with-error.png");
  });
});

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
test.describe("Input", () => {
  test("all types", async ({ page }) => {
    await page.goto(storyUrl("ui-input--all-types"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("input-all-types.png");
  });
});

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------
test.describe("Select", () => {
  test("default", async ({ page }) => {
    await page.goto(storyUrl("ui-select--default"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("select-default.png");
  });
});

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
test.describe("Skeleton", () => {
  test("composite loading", async ({ page }) => {
    await page.goto(storyUrl("ui-skeleton--composite-loading"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("skeleton-composite.png");
  });
});

// ---------------------------------------------------------------------------
// SlideOver
// ---------------------------------------------------------------------------
test.describe("SlideOver", () => {
  test("default", async ({ page }) => {
    await page.goto(storyUrl("ui-slideover--default"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("slideover-default.png");
  });
});

// ---------------------------------------------------------------------------
// SSEIndicator
// ---------------------------------------------------------------------------
test.describe("SSEIndicator", () => {
  test("all states", async ({ page }) => {
    await page.goto(storyUrl("ui-sseindicator--all-states"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("sseindicator-all-states.png");
  });
});

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------
test.describe("Switch", () => {
  test("default", async ({ page }) => {
    await page.goto(storyUrl("ui-switch--default"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("switch-default.png");
  });

  test("checked", async ({ page }) => {
    await page.goto(storyUrl("ui-switch--checked"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("switch-checked.png");
  });
});

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------
test.describe("Table", () => {
  test("default", async ({ page }) => {
    await page.goto(storyUrl("ui-table--default"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("table-default.png");
  });
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
test.describe("Tabs", () => {
  test("default", async ({ page }) => {
    await page.goto(storyUrl("ui-tabs--default"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("tabs-default.png");
  });

  test("with badges", async ({ page }) => {
    await page.goto(storyUrl("ui-tabs--with-badges"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("tabs-with-badges.png");
  });
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
test.describe("Toast", () => {
  test("all variants", async ({ page }) => {
    await page.goto(storyUrl("ui-toast--all-variants"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("toast-all-variants.png");
  });
});

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
test.describe("Tooltip", () => {
  test("all placements", async ({ page }) => {
    await page.goto(storyUrl("ui-tooltip--all-placements"));
    await waitForStory(page);
    await expect(page).toHaveScreenshot("tooltip-all-placements.png");
  });
});
