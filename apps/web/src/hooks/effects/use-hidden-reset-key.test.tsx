import { render, screen } from "@testing-library/react";
import { Activity } from "react";
import { describe, expect, it } from "vitest";
import { useHiddenResetKey } from "./use-hidden-reset-key";

function Probe() {
  return <output data-testid="key">{useHiddenResetKey()}</output>;
}

function Host({ mode }: { mode: "visible" | "hidden" }) {
  return (
    <Activity mode={mode}>
      <Probe />
    </Activity>
  );
}

describe("useHiddenResetKey", () => {
  it("keeps its key while shown and changes it after each Activity hide", () => {
    const { rerender } = render(<Host mode="visible" />);
    expect(screen.getByTestId("key")).toHaveTextContent("0");

    rerender(<Host mode="visible" />);
    expect(screen.getByTestId("key")).toHaveTextContent("0");

    rerender(<Host mode="hidden" />);
    rerender(<Host mode="visible" />);
    expect(screen.getByTestId("key")).toHaveTextContent("1");

    rerender(<Host mode="hidden" />);
    rerender(<Host mode="visible" />);
    expect(screen.getByTestId("key")).toHaveTextContent("2");
  });
});
