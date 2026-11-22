import { render, screen } from "@testing-library/react";
import { Activity, type RefObject, StrictMode, useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useSeoFocusHandoffDialogReturn } from "./use-seo-focus-handoff-dialog-return";

function DialogReturnHarness({
  handoff,
  dialogOpen,
  hasControl = true,
}: {
  handoff: RefObject<boolean>;
  dialogOpen: boolean;
  hasControl?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useSeoFocusHandoffDialogReturn(handoff, box, dialogOpen);
  return (
    <div>
      <input aria-label="Elsewhere" />
      <div ref={box}>
        {hasControl ? <button type="button">Connect</button> : null}
      </div>
    </div>
  );
}

describe("useSeoFocusHandoffDialogReturn", () => {
  it("focuses the box control with preventScroll and clears handoff when dialog closes", () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const handoff = { current: true };
    const { rerender, unmount } = render(
      <DialogReturnHarness handoff={handoff} dialogOpen={true} />,
    );
    expect(focusSpy).not.toHaveBeenCalled();

    rerender(<DialogReturnHarness handoff={handoff} dialogOpen={false} />);
    expect(screen.getByRole("button", { name: "Connect" })).toHaveFocus();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(handoff.current).toBe(false);

    unmount();
  });

  it("keeps handoff armed when no control exists or focus is not on body", () => {
    const handoff = { current: true };
    const { rerender } = render(
      <DialogReturnHarness
        handoff={handoff}
        dialogOpen={true}
        hasControl={false}
      />,
    );
    rerender(
      <DialogReturnHarness
        handoff={handoff}
        dialogOpen={false}
        hasControl={false}
      />,
    );
    expect(handoff.current).toBe(true);

    rerender(
      <DialogReturnHarness handoff={handoff} dialogOpen={true} hasControl />,
    );
    const elsewhere = screen.getByLabelText("Elsewhere");
    elsewhere.focus();
    rerender(
      <DialogReturnHarness handoff={handoff} dialogOpen={false} hasControl />,
    );
    expect(elsewhere).toHaveFocus();
    expect(handoff.current).toBe(true);
  });

  it("matches StrictMode replay and Activity hide/reveal behaviour", () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const handoff = { current: true };
    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <DialogReturnHarness handoff={handoff} dialogOpen={true} />
        </Activity>
      </StrictMode>,
    );
    expect(focusSpy).not.toHaveBeenCalled();

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <DialogReturnHarness handoff={handoff} dialogOpen={false} />
        </Activity>
      </StrictMode>,
    );
    expect(focusSpy).not.toHaveBeenCalled();
    expect(handoff.current).toBe(true);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <DialogReturnHarness handoff={handoff} dialogOpen={false} />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByRole("button", { name: "Connect" })).toHaveFocus();
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(handoff.current).toBe(false);

    unmount();
  });
});
