import { act, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { renderMermaidMock } = vi.hoisted(() => ({
  renderMermaidMock: vi.fn(),
}));

vi.mock("@/components/mermaid/render-mermaid", () => ({
  renderMermaid: renderMermaidMock,
}));

import {
  type MermaidDiagramRenderResult,
  useMermaidDiagramRender,
} from "./use-mermaid-diagram-render";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useMermaidDiagramRender", () => {
  const originalIntersectionObserver = globalThis.IntersectionObserver;

  beforeEach(() => {
    renderMermaidMock.mockReset();
  });

  afterEach(() => {
    globalThis.IntersectionObserver = originalIntersectionObserver;
    vi.restoreAllMocks();
  });

  it("renders lazily on intersection, aborts when leaving view before finish, and disconnects on unmount", async () => {
    const observers: Array<{
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      trigger: (isIntersecting: boolean) => void;
    }> = [];

    class FakeIntersectionObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = "";
      scrollMargin = "";
      thresholds = [];

      constructor(private readonly cb: IntersectionObserverCallback) {
        observers.push({
          observe: this.observe,
          disconnect: this.disconnect,
          trigger: (isIntersecting: boolean) => {
            this.cb([{ isIntersecting } as IntersectionObserverEntry], this);
          },
        });
      }
    }

    globalThis.IntersectionObserver = FakeIntersectionObserver;

    const first = deferred<string>();
    const signals: AbortSignal[] = [];
    renderMermaidMock.mockImplementation(
      (_source: string, _dark: boolean, signal: AbortSignal) => {
        signals.push(signal);
        return signals.length === 1
          ? first.promise
          : Promise.resolve("<svg>ok</svg>");
      },
    );

    const captured: { result: MermaidDiagramRenderResult | undefined } = {
      result: undefined,
    };

    function Probe({
      source,
      complete,
      dark,
    }: {
      source: string;
      complete: boolean;
      dark: boolean;
    }) {
      const root = useRef<HTMLElement>(null);
      const { result } = useMermaidDiagramRender({
        root,
        source,
        complete,
        error: null,
        dark,
      });
      captured.result = result;
      return <figure ref={root} />;
    }

    const { rerender, unmount } = render(
      <Probe source="graph TD; A-->B" complete={false} dark={false} />,
    );
    expect(observers).toHaveLength(0);

    rerender(<Probe source="graph TD; A-->B" complete={true} dark={false} />);
    expect(observers).toHaveLength(1);
    expect(observers[0]?.observe).toHaveBeenCalledTimes(1);

    // Entering view starts render; leaving before it resolves aborts it.
    act(() => {
      observers[0]?.trigger(true);
    });
    await waitFor(() => {
      expect(renderMermaidMock).toHaveBeenCalledTimes(1);
    });
    expect(signals[0]?.aborted).toBe(false);

    act(() => {
      observers[0]?.trigger(false);
    });
    expect(signals[0]?.aborted).toBe(true);

    // Re-entering starts a fresh attempt that succeeds and disconnects the observer.
    act(() => {
      observers[0]?.trigger(true);
    });
    await waitFor(() => {
      expect(captured.result).toEqual({
        source: "graph TD; A-->B",
        dark: false,
        svg: "<svg>ok</svg>",
      });
    });
    expect(observers[0]?.disconnect).toHaveBeenCalled();

    // Changing dark re-arms observer for the new theme.
    rerender(<Probe source="graph TD; A-->B" complete={true} dark={true} />);
    expect(observers).toHaveLength(2);

    unmount();
    expect(observers[1]?.disconnect).toHaveBeenCalledTimes(1);
  });
});
