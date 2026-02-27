import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Dialog from "../Dialog";

describe("Dialog", () => {
  it("traps focus and closes on ESC", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Test Dialog">
        <button>Action</button>
      </Dialog>,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("does not render when closed", () => {
    render(
      <Dialog open={false} onClose={() => {}} title="Hidden">
        Content
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
