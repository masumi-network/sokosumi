import { render, renderHook } from "@testing-library/react";
import { Activity, useRef } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useScrollIntoViewWhen } from "./use-scroll-into-view-when";

describe("useScrollIntoViewWhen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("scrolls ref.current into view with options when condition turns true", () => {
    const element = document.createElement("div");
    const scrollSpy = vi.fn();
    element.scrollIntoView = scrollSpy;
    const ref = { current: element };

    const { rerender } = renderHook(
      ({ when }: { when: boolean }) =>
        useScrollIntoViewWhen(ref, when, {
          block: "center",
          inline: "nearest",
        }),
      { initialProps: { when: false } },
    );

    expect(scrollSpy).not.toHaveBeenCalled();

    rerender({ when: true });
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
    });

    // Unrelated re-render with unchanged deps does not re-scroll.
    rerender({ when: true });
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("does not re-scroll when the element remounts with an unchanged condition", () => {
    const scrollSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy;

    try {
      function Probe({ nodeKey }: { nodeKey: string }) {
        const ref = useRef<HTMLDivElement>(null);
        useScrollIntoViewWhen(ref, true, { block: "nearest" });
        return (
          <div key={nodeKey} ref={ref}>
            target
          </div>
        );
      }

      const { rerender } = render(<Probe nodeKey="a" />);
      expect(scrollSpy).toHaveBeenCalledTimes(1);

      rerender(<Probe nodeKey="b" />);
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("scrolls only the new target exactly once when the trigger changes", () => {
    const scrolledIndices: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolledIndices.push(this.getAttribute("data-index") ?? "");
    };

    try {
      function ListProbe({
        isOpen,
        activeIndex,
      }: {
        isOpen: boolean;
        activeIndex: number;
      }) {
        const listRef = useRef<HTMLDivElement>(null);
        useScrollIntoViewWhen(
          () => listRef.current?.querySelector(`[data-index="${activeIndex}"]`),
          isOpen,
          { block: "nearest", resetKey: activeIndex },
        );
        return (
          <div ref={listRef}>
            <div data-index="0">first</div>
            <div data-index="1">second</div>
            <div data-index="2">third</div>
          </div>
        );
      }

      const { rerender } = render(<ListProbe isOpen activeIndex={0} />);
      expect(scrolledIndices).toEqual(["0"]);

      scrolledIndices.length = 0;
      rerender(<ListProbe isOpen activeIndex={1} />);
      expect(scrolledIndices).toEqual(["1"]);

      scrolledIndices.length = 0;
      rerender(<ListProbe isOpen activeIndex={2} />);
      expect(scrolledIndices).toEqual(["2"]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("switches smooth scrolling to auto when respectReducedMotion is set and reduced motion matches", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

    const element = document.createElement("li");
    const scrollSpy = vi.fn();
    element.scrollIntoView = scrollSpy;
    const ref = { current: element };

    renderHook(() =>
      useScrollIntoViewWhen(ref, true, {
        block: "center",
        behavior: "smooth",
        respectReducedMotion: true,
      }),
    );

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({
      block: "center",
      behavior: "auto",
    });
  });

  it("keeps smooth scrolling when respectReducedMotion is set and reduced motion is off", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

    const element = document.createElement("li");
    const scrollSpy = vi.fn();
    element.scrollIntoView = scrollSpy;
    const ref = { current: element };

    renderHook(() =>
      useScrollIntoViewWhen(ref, true, {
        block: "center",
        behavior: "smooth",
        respectReducedMotion: true,
      }),
    );

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({
      block: "center",
      behavior: "smooth",
    });
  });

  it("re-runs on React Activity hide and reveal", () => {
    const scrollSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy;

    try {
      function Probe() {
        const ref = useRef<HTMLDivElement>(null);
        useScrollIntoViewWhen(ref, true, { block: "nearest" });
        return <div ref={ref}>target</div>;
      }

      const { rerender } = render(
        <Activity mode="visible">
          <Probe />
        </Activity>,
      );
      expect(scrollSpy).toHaveBeenCalledTimes(1);

      rerender(
        <Activity mode="hidden">
          <Probe />
        </Activity>,
      );
      rerender(
        <Activity mode="visible">
          <Probe />
        </Activity>,
      );
      expect(scrollSpy).toHaveBeenCalledTimes(2);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("does not throw during SSR", () => {
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      useScrollIntoViewWhen(ref, true, { block: "center" });
      return <span ref={ref}>ok</span>;
    }

    expect(renderToString(<Probe />)).toBe("<span>ok</span>");
  });
});
