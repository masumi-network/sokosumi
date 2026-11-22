import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEmailCodeRefusalFocus } from "./use-email-code-refusal-focus";

describe("useEmailCodeRefusalFocus", () => {
  it("defers focus while locked and focuses once on the first unlocked render after a refusal", () => {
    const focus = vi.fn();
    const captured: { requestFocus: (() => void) | null } = {
      requestFocus: null,
    };

    function Probe({ isLocked, tick }: { isLocked: boolean; tick: number }) {
      captured.requestFocus = useEmailCodeRefusalFocus(focus, isLocked);
      return <span data-tick={tick} />;
    }

    const { rerender, unmount } = render(<Probe isLocked={true} tick={0} />);
    expect(focus).not.toHaveBeenCalled();

    // Armed while locked: must not focus until unlocked.
    act(() => {
      captured.requestFocus?.();
    });
    rerender(<Probe isLocked={true} tick={1} />);
    expect(focus).not.toHaveBeenCalled();

    // Unlocking triggers focus exactly once.
    rerender(<Probe isLocked={false} tick={2} />);
    expect(focus).toHaveBeenCalledTimes(1);

    // Subsequent unlocked rerenders do not re-focus without another refusal.
    rerender(<Probe isLocked={false} tick={3} />);
    expect(focus).toHaveBeenCalledTimes(1);

    unmount();
  });
});
