import { render, screen } from "@testing-library/react";
import { Activity, StrictMode, useRef } from "react";
import { describe, expect, it } from "vitest";
import { useCategoriesDragCursor } from "./use-categories-drag-cursor";

describe("useCategoriesDragCursor", () => {
  it("sets cursor to grab on mount and clears cursor and userSelect on unmount", () => {
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      useCategoriesDragCursor(ref);
      return <div ref={ref} data-testid="scroller" />;
    }

    const { unmount } = render(<Probe />);
    const scroller = screen.getByTestId("scroller");
    expect(scroller.style.cursor).toBe("grab");

    scroller.style.cursor = "grabbing";
    scroller.style.userSelect = "none";

    unmount();
    expect(scroller.style.cursor).toBe("");
    expect(scroller.style.userSelect).toBe("");
  });

  it("survives StrictMode replay and clears/reapplies across Activity hide and reveal", () => {
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      useCategoriesDragCursor(ref);
      return <div ref={ref} data-testid="scroller" />;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    const scroller = screen.getByTestId("scroller");
    expect(scroller.style.cursor).toBe("grab");

    scroller.style.userSelect = "none";
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(scroller.style.cursor).toBe("");
    expect(scroller.style.userSelect).toBe("");

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(scroller.style.cursor).toBe("grab");

    unmount();
  });
});
