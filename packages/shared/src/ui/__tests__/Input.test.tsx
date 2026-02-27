import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Input from "../Input";

describe("Input", () => {
  it("renders label when provided", () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  it("shows error message", () => {
    render(<Input error="Required field" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Required field");
  });
});
