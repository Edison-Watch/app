import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Badge from "../Badge";

describe("Badge", () => {
  it("renders all variants", () => {
    const variants = [
      "success",
      "warning",
      "danger",
      "info",
      "neutral",
      "blocked",
    ] as const;
    for (const variant of variants) {
      const { unmount } = render(<Badge variant={variant}>{variant}</Badge>);
      expect(screen.getByText(variant)).toBeTruthy();
      unmount();
    }
  });
});
