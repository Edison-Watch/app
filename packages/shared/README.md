# @edison/shared

Shared design system, UI components, auth utilities, and configuration helpers for the Edison Watch platform.

## UI Components

17 React components built with TailwindCSS 4 and Edison design tokens:

Badge, Button, Card, Dialog, Dropdown, EmptyState, ErrorBoundary, Input, Select, Skeleton, SlideOver, SSEIndicator, Switch, Table, Tabs, Toast, Tooltip

## Scripts

```bash
npm run build            # Build with tsup
npm run typecheck        # TypeScript type checking
npm run test             # Unit tests (Vitest)
npm run storybook        # Storybook dev server (port 6006)
npm run build-storybook  # Build static Storybook
npm run test:visual      # Visual regression tests (Playwright)
npm run test:visual:update  # Update visual regression baselines
```

## Visual Regression Testing

Visual regression tests use Playwright's `toHaveScreenshot()` to detect unintended visual changes to UI components. Tests run against a built Storybook and capture screenshots of representative stories for each component.

### How it works

1. Storybook is built to `storybook-static/`
2. Playwright serves `storybook-static/` via a local HTTP server
3. Each test navigates to a component story's iframe URL
4. `toHaveScreenshot()` compares the current screenshot against the baseline

### Running locally

```bash
# Build Storybook first
npm run build-storybook

# Run visual tests (compares against baselines)
npm run test:visual

# Update baselines after intentional visual changes
npm run test:visual:update
```

### Updating baselines

When you intentionally change a component's appearance:

1. Make your changes to the component
2. Run `npm run build-storybook` to rebuild Storybook
3. Run `npm run test:visual:update` to regenerate baseline screenshots
4. Commit the updated `.png` files in `visual-tests/components.spec.ts-snapshots/`

### CI workflow

The GitHub Actions workflow (`.github/workflows/visual-regression-shared.yaml`) runs automatically on PRs that modify:

- `packages/shared/src/ui/**` — component source
- `packages/shared/src/theme/**` — design tokens
- `packages/shared/.storybook/**` — Storybook config
- `packages/shared/visual-tests/**` — test files and baselines

If a visual diff is detected, the workflow fails and uploads diff artifacts for review.

### Test coverage

24 visual tests covering all 17 UI components with composite/variant stories:

| Component | Stories tested |
|---|---|
| Badge | all-variants, all-sizes |
| Button | all-variants, all-sizes, loading-variants, disabled-variants |
| Card | default, with-header-and-footer |
| Dialog | open-by-default |
| Dropdown | default |
| EmptyState | with-action |
| ErrorBoundary | with-error |
| Input | all-types |
| Select | default |
| Skeleton | composite-loading |
| SlideOver | default |
| SSEIndicator | all-states |
| Switch | default, checked |
| Table | default |
| Tabs | default, with-badges |
| Toast | all-variants |
| Tooltip | all-placements |
