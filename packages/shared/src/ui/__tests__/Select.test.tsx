import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Select from "../Select";

describe("Select", () => {
  const options = [
    { value: "a", label: "Apple" },
    { value: "b", label: "Banana" },
    { value: "c", label: "Cherry" },
  ];

  it("opens and selects an option", () => {
    const onChange = vi.fn();
    render(
      <Select options={options} onChange={onChange} placeholder="Pick fruit" />,
    );

    fireEvent.click(screen.getByText("Pick fruit"));
    fireEvent.click(screen.getByText("Banana"));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("filters options when searchable", () => {
    const onChange = vi.fn();
    render(
      <Select
        options={options}
        onChange={onChange}
        searchable
        placeholder="Pick"
      />,
    );

    fireEvent.click(screen.getByText("Pick"));
    const searchInput = screen.getByPlaceholderText("Search...");
    fireEvent.change(searchInput, { target: { value: "ch" } });

    // Only Cherry should be visible
    expect(screen.queryByText("Apple")).toBeNull();
    expect(screen.queryByText("Banana")).toBeNull();
    expect(screen.getByText("Cherry")).toBeDefined();
  });

  it("loads options asynchronously", async () => {
    const loadOptions = vi.fn().mockResolvedValue([
      { value: "x", label: "X-Ray" },
      { value: "y", label: "Yankee" },
    ]);

    render(<Select loadOptions={loadOptions} placeholder="Async" />);
    fireEvent.click(screen.getByText("Async"));

    await waitFor(() => {
      expect(screen.getByText("X-Ray")).toBeDefined();
      expect(screen.getByText("Yankee")).toBeDefined();
    });
    expect(loadOptions).toHaveBeenCalledWith("");
  });
});
