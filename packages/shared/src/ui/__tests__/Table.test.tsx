import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Table from "../Table";

interface TestRow {
  id: string;
  name: string;
  count: number;
}

const columns = [
  {
    key: "name",
    header: "Name",
    sortable: true,
    render: (r: TestRow) => r.name,
  },
  {
    key: "count",
    header: "Count",
    sortable: true,
    numeric: true,
    render: (r: TestRow) => r.count,
  },
];

const data: TestRow[] = [
  { id: "1", name: "Beta", count: 10 },
  { id: "2", name: "Alpha", count: 20 },
];

describe("Table", () => {
  it("sorts on header click", () => {
    render(<Table columns={columns} data={data} getRowKey={(r) => r.id} />);
    const nameHeader = screen.getByText("Name");
    fireEvent.click(nameHeader);
    const cells = screen.getAllByRole("cell");
    // After ascending sort by name: Alpha should be first
    expect(cells[0]).toHaveTextContent("Alpha");
  });

  it("shows skeleton rows when loading", () => {
    render(
      <Table columns={columns} data={[]} loading getRowKey={(r) => r.id} />,
    );
    // Should render 5 skeleton rows (each with animated pulse divs)
    const rows = document.querySelectorAll("tbody tr");
    expect(rows.length).toBe(5);
  });
});
