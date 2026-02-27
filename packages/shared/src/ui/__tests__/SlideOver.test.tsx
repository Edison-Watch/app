import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SlideOver from "../SlideOver";

describe("SlideOver", () => {
  it("renders when open", () => {
    render(
      <SlideOver open onClose={vi.fn()} title="Test Panel">
        <p>Panel content</p>
      </SlideOver>,
    );
    expect(screen.getByText("Test Panel")).toBeDefined();
    expect(screen.getByText("Panel content")).toBeDefined();
  });

  it("does not render when closed", () => {
    render(
      <SlideOver open={false} onClose={vi.fn()} title="Hidden Panel">
        <p>Hidden</p>
      </SlideOver>,
    );
    expect(screen.queryByText("Hidden Panel")).toBeNull();
  });

  it("closes on ESC key", () => {
    const onClose = vi.fn();
    render(
      <SlideOver open onClose={onClose} title="ESC Test">
        <button>Focus me</button>
      </SlideOver>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
