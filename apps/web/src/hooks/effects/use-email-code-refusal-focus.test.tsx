import { render } from "@testing-library/react";
import { type RefObject, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useEmailCodeRefusalFocus } from "./use-email-code-refusal-focus";

describe("useEmailCodeRefusalFocus", () => {
  it("defers focus while locked and focuses once on the first unlocked render after a refusal", () => {
    const focus = vi.fn();
    const captured: { ref: RefObject<boolean> | null } = { ref: null };

    function Probe({ isLocked, tick }: { isLocked: boolean; tick: number }) {
      const focusPending = useRef(false);
      captured.ref = focusPending;
      useEmailCodeRefusalFocus(focusPending, focus, isLocked);
      return <span data-tick={tick} />;
    }

    const { rerender, unmount } = render(<Probe isLocked={true} tick={0} />);
    expect(focus).not.toHaveBeenCalled();

    // Armed while locked: must not focus until unlocked.
    if (!captured.ref) throw new Error("expected focusPending ref");
    captured.ref.current = true;
    rerender(<Probe isLocked={true} tick={1} />);
    expect(focus).not.toHaveBeenCalled();

    // Unlocking triggers focus exactly once and clears the pending flag.
    rerender(<Probe isLocked={false} tick={2} />);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(captured.ref.current).toBe(false);

    // Subsequent unlocked rerenders do not re-focus without another refusal.
    rerender(<Probe isLocked={false} tick={3} />);
    expect(focus).toHaveBeenCalledTimes(1);

    unmount();
  });
});
