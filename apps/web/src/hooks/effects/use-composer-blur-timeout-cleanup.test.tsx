import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useComposerBlurTimeoutCleanup } from "./use-composer-blur-timeout-cleanup";

function Probe({
  blurTimeoutRef,
}: {
  blurTimeoutRef: { current: ReturnType<typeof setTimeout> | null };
}) {
  useComposerBlurTimeoutCleanup(blurTimeoutRef);
  return null;
}

describe("useComposerBlurTimeoutCleanup", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears a pending blur timeout on unmount and leaves it alone while mounted", () => {
    vi.useFakeTimers();
    const onBlur = vi.fn();
    const blurTimeoutRef: { current: ReturnType<typeof setTimeout> | null } = {
      current: setTimeout(() => {
        onBlur();
      }, 150),
    };

    const { unmount } = render(<Probe blurTimeoutRef={blurTimeoutRef} />);
    unmount();

    vi.advanceTimersByTime(200);
    expect(onBlur).not.toHaveBeenCalled();
  });
});
