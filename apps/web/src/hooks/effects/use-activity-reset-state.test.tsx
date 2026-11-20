import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity, StrictMode } from "react";
import { describe, expect, it } from "vitest";

import { useActivityResetState } from "./use-activity-reset-state";

function Counter({ label }: { label: string }) {
  const [count, setCount] = useActivityResetState(0);
  return (
    <div>
      <span>{label}</span>
      <output data-testid="count">{count}</output>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Increment
      </button>
    </div>
  );
}

describe("useActivityResetState", () => {
  it("preserves state across rerenders and resets before paint when Activity hides", async () => {
    const user = userEvent.setup();
    function Harness({
      mode = "visible",
      label = "first",
    }: {
      mode?: "hidden" | "visible";
      label?: string;
    }) {
      return (
        <StrictMode>
          <Activity mode={mode}>
            <Counter label={label} />
          </Activity>
        </StrictMode>
      );
    }

    const { rerender } = render(<Harness />);
    expect(screen.getByTestId("count")).toHaveTextContent("0");

    await user.click(screen.getByRole("button", { name: "Increment" }));
    expect(screen.getByTestId("count")).toHaveTextContent("1");

    // Ordinary prop refresh keeps the current state.
    rerender(<Harness label="refreshed" />);
    expect(screen.getByTestId("count")).toHaveTextContent("1");

    // Hiding the Activity resets state so reveal renders the initial value.
    rerender(<Harness mode="hidden" />);
    rerender(<Harness mode="visible" />);
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });
});
