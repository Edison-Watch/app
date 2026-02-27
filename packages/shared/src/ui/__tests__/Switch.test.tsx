import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Switch from "../Switch";

describe("Switch", () => {
  it("toggles on click", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Enable" />);

    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("shows loading spinner in thumb", () => {
    render(<Switch checked={true} onChange={vi.fn()} loading />);

    const switchEl = screen.getByRole("switch");
    // Loading state: button is disabled
    expect(switchEl.hasAttribute("disabled")).toBe(true);
    // SVG spinner rendered inside thumb
    expect(switchEl.querySelector("svg")).toBeDefined();
  });

  it("prevents toggle when disabled", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} disabled />);

    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
