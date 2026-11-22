import { render, screen } from "@testing-library/react";
import { Activity, type RefObject, StrictMode, useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useTaskSubtaskMoveFocus } from "./use-task-subtask-move-focus";

function MoveFocusHarness({
  order,
  movedId,
}: {
  order: string;
  movedId: RefObject<string | null>;
}) {
  const handles = useRef(new Map<string, HTMLButtonElement>());
  useTaskSubtaskMoveFocus(handles, movedId, order);
  return (
    <div>
      {order.split(",").map((id) => (
        <button
          key={id}
          type="button"
          ref={(node) => {
            if (node) handles.current.set(id, node);
            else handles.current.delete(id);
          }}
        >
          Handle {id}
        </button>
      ))}
    </div>
  );
}

describe("useTaskSubtaskMoveFocus", () => {
  it("focuses the moved row handle when order changes and clears movedId", () => {
    const movedId = { current: null as string | null };
    const { rerender, unmount } = render(
      <MoveFocusHarness order="a,b,c" movedId={movedId} />,
    );
    expect(screen.getByRole("button", { name: "Handle a" })).not.toHaveFocus();

    movedId.current = "b";
    rerender(<MoveFocusHarness order="b,a,c" movedId={movedId} />);
    expect(screen.getByRole("button", { name: "Handle b" })).toHaveFocus();
    expect(movedId.current).toBeNull();

    // Rerendering with the same order does not re-focus or clear movedId.
    const handleA = screen.getByRole("button", { name: "Handle a" });
    handleA.focus();
    movedId.current = "c";
    rerender(<MoveFocusHarness order="b,a,c" movedId={movedId} />);
    expect(handleA).toHaveFocus();
    expect(movedId.current).toBe("c");

    // Unknown movedId does not steal focus and still clears movedId on order change.
    movedId.current = "missing";
    rerender(<MoveFocusHarness order="a,b,c" movedId={movedId} />);
    expect(handleA).toHaveFocus();
    expect(movedId.current).toBeNull();

    unmount();
  });

  it("matches StrictMode replay and Activity hide/reveal behaviour", () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const movedId = { current: "a" as string | null };
    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <MoveFocusHarness order="a,b" movedId={movedId} />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByRole("button", { name: "Handle a" })).toHaveFocus();
    // Run 1 focuses and clears movedId; StrictMode replay sees movedId === null.
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(movedId.current).toBeNull();

    movedId.current = "b";
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <MoveFocusHarness order="a,b" movedId={movedId} />
        </Activity>
      </StrictMode>,
    );
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(movedId.current).toBe("b");

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <MoveFocusHarness order="a,b" movedId={movedId} />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByRole("button", { name: "Handle b" })).toHaveFocus();
    expect(focusSpy).toHaveBeenCalledTimes(2);
    expect(movedId.current).toBeNull();

    unmount();
  });
});
