import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Dropdown from "../Dropdown";

describe("Dropdown", () => {
  const items = [
    { key: "edit", label: "Edit" },
    { key: "delete", label: "Delete", danger: true },
    { key: "disabled", label: "Disabled", disabled: true },
  ];

  it("opens on click and shows items", () => {
    const onSelect = vi.fn();
    render(
      <Dropdown
        trigger={<span>Menu</span>}
        items={items}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByText("Menu"));
    expect(screen.getByText("Edit")).toBeDefined();
    expect(screen.getByText("Delete")).toBeDefined();
  });

  it("calls onSelect when clicking an item", () => {
    const onSelect = vi.fn();
    render(
      <Dropdown
        trigger={<span>Menu</span>}
        items={items}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByText("Menu"));
    fireEvent.click(screen.getByText("Edit"));
    expect(onSelect).toHaveBeenCalledWith("edit");
  });

  it("navigates with keyboard arrows and selects with Enter", () => {
    const onSelect = vi.fn();
    render(
      <Dropdown
        trigger={<span>Menu</span>}
        items={items}
        onSelect={onSelect}
      />,
    );

    const trigger = screen.getByText("Menu").parentElement!;
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    // Now menu is open, focused on first item
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    // Focused on second enabled item (delete)
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("delete");
  });
});
