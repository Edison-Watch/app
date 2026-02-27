import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "../Toast";

function ToastTrigger() {
  const { addToast } = useToast();
  return <button onClick={() => addToast("Test message", "success")}>Show</button>;
}

describe("Toast", () => {
  it("auto-dismisses after 5 seconds", () => {
    vi.useFakeTimers();

    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    act(() => {
      screen.getByText("Show").click();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Test message");

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByRole("alert")).toBeNull();

    vi.useRealTimers();
  });
});
