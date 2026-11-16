import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSeoFocusHandoff } from "./use-seo-focus-handoff";

afterEach(cleanup);

function Line({ cause, hidden }: { cause: string; hidden: boolean }) {
  const { box, target } = useSeoFocusHandoff(cause, hidden);
  return (
    <div>
      <input aria-label="Elsewhere" />
      <div ref={box}>
        <p ref={target} tabIndex={-1}>
          {hidden ? "" : cause}
        </p>
        {!hidden && cause === "missing" ? (
          <button type="button">Connect</button>
        ) : null}
      </div>
    </div>
  );
}

describe("useSeoFocusHandoff", () => {
  it("gives the focus to the text when the control that held it leaves with its cause", () => {
    const { rerender } = render(<Line cause="missing" hidden={false} />);
    screen.getByRole("button", { name: "Connect" }).focus();
    rerender(<Line cause="empty" hidden={false} />);
    expect(screen.getByText("empty")).toHaveFocus();
  });

  it("keeps the focus for the cause that follows a hidden phase", () => {
    const { rerender } = render(<Line cause="missing" hidden={false} />);
    screen.getByRole("button", { name: "Connect" }).focus();
    rerender(<Line cause="missing" hidden />);
    rerender(<Line cause="empty" hidden />);
    rerender(<Line cause="empty" hidden={false} />);
    expect(screen.getByText("empty")).toHaveFocus();
  });

  it("gives the focus back after a dialog the control opened, even when the control is gone", () => {
    function WithDialog({ hidden, open }: { hidden: boolean; open: boolean }) {
      const { box, target, arm } = useSeoFocusHandoff("choose", hidden);
      return (
        <div>
          <div ref={box}>
            <p ref={target} tabIndex={-1}>
              Choose
            </p>
            {hidden ? null : (
              <button type="button" onClick={arm}>
                Choose property
              </button>
            )}
          </div>
          {open ? (
            <div role="dialog">
              <input aria-label="Property" />
            </div>
          ) : null}
        </div>
      );
    }
    const { rerender } = render(<WithDialog hidden={false} open={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose property" }));
    rerender(<WithDialog hidden={false} open />);
    screen.getByLabelText("Property").focus();
    // The pick starts a sync: the line hides, the dialog closes, the focus falls to the page.
    rerender(<WithDialog hidden open />);
    fireEvent.pointerDown(screen.getByLabelText("Property"));
    rerender(<WithDialog hidden open={false} />);
    rerender(<WithDialog hidden={false} open={false} />);
    expect(screen.getByText("Choose")).toHaveFocus();
  });

  it("drops the handoff when the reader presses somewhere while the line waits", () => {
    const { rerender } = render(<Line cause="missing" hidden={false} />);
    screen.getByRole("button", { name: "Connect" }).focus();
    rerender(<Line cause="missing" hidden />);
    // The press lands on plain text: the focus stays on the page.
    fireEvent.pointerDown(document.body);
    rerender(<Line cause="empty" hidden={false} />);
    expect(screen.getByText("empty")).not.toHaveFocus();
  });

  it("does not take the focus from where the reader put it, nor later", () => {
    const { rerender } = render(<Line cause="missing" hidden={false} />);
    screen.getByRole("button", { name: "Connect" }).focus();
    rerender(<Line cause="missing" hidden />);
    const elsewhere = screen.getByLabelText("Elsewhere");
    elsewhere.focus();
    rerender(<Line cause="empty" hidden={false} />);
    expect(elsewhere).toHaveFocus();
    // The handoff was spent: a later cause does not pull the focus from the page.
    elsewhere.blur();
    rerender(<Line cause="choose" hidden={false} />);
    expect(screen.getByText("choose")).not.toHaveFocus();
  });
});
