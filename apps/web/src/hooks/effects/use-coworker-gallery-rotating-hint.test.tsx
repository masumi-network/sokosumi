import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCoworkerGalleryRotatingHint } from "./use-coworker-gallery-rotating-hint";

describe("useCoworkerGalleryRotatingHint", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cycles every 3s when multiple hints exist, pauses on reduced motion, and clears on unmount", () => {
    vi.useFakeTimers();
    const captured = { idx: -1 };

    function Probe({
      hintCount,
      reduceMotion,
    }: {
      hintCount: number;
      reduceMotion: boolean;
    }) {
      captured.idx = useCoworkerGalleryRotatingHint(hintCount, reduceMotion);
      return null;
    }

    const { rerender, unmount } = render(
      <Probe hintCount={3} reduceMotion={false} />,
    );
    expect(captured.idx).toBe(0);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(captured.idx).toBe(1);

    // Changing hintCount restarts interval with the new modulus.
    rerender(<Probe hintCount={2} reduceMotion={false} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(captured.idx).toBe(0);

    // Enabling reduced motion stops further cycling.
    rerender(<Probe hintCount={2} reduceMotion={true} />);
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(captured.idx).toBe(0);

    // Single hint does not start an interval.
    rerender(<Probe hintCount={1} reduceMotion={false} />);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(captured.idx).toBe(0);

    rerender(<Probe hintCount={3} reduceMotion={false} />);
    unmount();
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(captured.idx).toBe(0);
  });
});
