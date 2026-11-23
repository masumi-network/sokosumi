import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTranscriptViewportOpened } from "./use-transcript-viewport-opened";

function Probe({ scroller }: { scroller: HTMLElement | null }) {
  const opened = useTranscriptViewportOpened(scroller);
  return <span data-testid="opened">{opened ? "yes" : "no"}</span>;
}

describe("useTranscriptViewportOpened", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays false until scroller mounts, then flips true on the next animation frame and cancels on unmount", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    const cancelSpy = vi
      .spyOn(globalThis, "cancelAnimationFrame")
      .mockImplementation((id) => {
        callbacks.delete(id);
      });
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    });

    const scroller = document.createElement("div");
    const { rerender, unmount } = render(<Probe scroller={null} />);
    expect(screen.getByTestId("opened")).toHaveTextContent("no");
    expect(callbacks.size).toBe(0);

    rerender(<Probe scroller={scroller} />);
    expect(screen.getByTestId("opened")).toHaveTextContent("no");
    expect(callbacks.size).toBe(1);

    // Unmount before the frame fires cancels the queued rAF.
    unmount();
    expect(cancelSpy).toHaveBeenCalledWith(1);

    // Fresh mount: firing the queued rAF transitions opened to true.
    const second = render(<Probe scroller={scroller} />);
    const cb = [...callbacks.values()][0];
    act(() => {
      cb?.(16);
    });
    expect(screen.getByTestId("opened")).toHaveTextContent("yes");
    second.unmount();
  });
});
