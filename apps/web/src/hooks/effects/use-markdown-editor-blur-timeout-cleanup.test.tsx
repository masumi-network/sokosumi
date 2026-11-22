import { render } from "@testing-library/react";
import { Activity, type RefObject, StrictMode, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMarkdownEditorBlurTimeoutCleanup } from "./use-markdown-editor-blur-timeout-cleanup";

describe("useMarkdownEditorBlurTimeoutCleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the stored blur timeout on unmount without cancelling across normal rerenders", () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const fired = vi.fn();
    const captured: {
      ref: RefObject<NodeJS.Timeout | number | null> | null;
    } = {
      ref: null,
    };

    function Probe({ tick }: { tick: number }) {
      const blurTimeoutRef = useRef<NodeJS.Timeout | number | null>(null);
      captured.ref = blurTimeoutRef;
      useMarkdownEditorBlurTimeoutCleanup(blurTimeoutRef);
      return <span data-tick={tick} />;
    }

    const { rerender, unmount } = render(<Probe tick={0} />);
    if (!captured.ref) throw new Error("expected ref");

    captured.ref.current = setTimeout(fired, 150);
    // Rerendering between ticks must not cancel the scheduled blur timeout.
    vi.advanceTimersByTime(75);
    rerender(<Probe tick={1} />);
    expect(clearSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(75);
    expect(fired).toHaveBeenCalledTimes(1);

    // Schedule another timeout and unmount before its deadline.
    captured.ref.current = setTimeout(fired, 150);
    vi.advanceTimersByTime(50);
    unmount();

    expect(clearSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("clears pending blur timeout on Activity hide and works across StrictMode replay and reveal", () => {
    const fired = vi.fn();
    const captured: {
      ref: RefObject<NodeJS.Timeout | number | null> | null;
    } = {
      ref: null,
    };

    function Probe() {
      const blurTimeoutRef = useRef<NodeJS.Timeout | number | null>(null);
      captured.ref = blurTimeoutRef;
      useMarkdownEditorBlurTimeoutCleanup(blurTimeoutRef);
      return null;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    if (!captured.ref) throw new Error("expected ref");

    captured.ref.current = setTimeout(fired, 150);
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    vi.advanceTimersByTime(200);
    expect(fired).not.toHaveBeenCalled();

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    captured.ref.current = setTimeout(fired, 150);
    vi.advanceTimersByTime(150);
    expect(fired).toHaveBeenCalledTimes(1);

    unmount();
  });
});
