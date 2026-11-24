import { render, screen } from "@testing-library/react";
import { Activity, useEffect, useLayoutEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTranscriptViewportScrollMargin } from "./use-transcript-viewport-scroll-margin";

function stubTop(element: Element, getTop: () => number) {
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        top: getTop(),
        bottom: getTop(),
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: getTop(),
        toJSON: () => ({}),
      }) as DOMRect,
  );
}

describe("useTranscriptViewportScrollMargin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("measures rounded container offset in layout phase before passive effects and updates on later renders when the container moves", () => {
    const scroller = document.createElement("div");
    let scrollerTop = 20;
    let containerTop = 160.6;
    scroller.scrollTop = 10;
    const events: string[] = [];
    vi.spyOn(scroller, "getBoundingClientRect").mockImplementation(() => {
      events.push("measure");
      return {
        top: scrollerTop,
        bottom: scrollerTop,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: scrollerTop,
        toJSON: () => ({}),
      } as DOMRect;
    });

    let renderCount = 0;

    function Probe({
      scrollerEl,
      tick,
    }: {
      scrollerEl: HTMLElement | null;
      tick: number;
    }) {
      renderCount += 1;
      const containerRef = useRef<HTMLDivElement | null>(null);
      const scrollMargin = useTranscriptViewportScrollMargin(
        scrollerEl,
        containerRef,
      );
      useLayoutEffect(() => {
        events.push(`layout:${scrollMargin}`);
      });
      useEffect(() => {
        events.push(`passive:${scrollMargin}`);
      });
      return (
        <div
          ref={(node) => {
            containerRef.current = node;
            if (node) stubTop(node, () => containerTop);
          }}
          data-testid="margin"
          data-tick={tick}
        >
          {scrollMargin}
        </div>
      );
    }

    const { rerender } = render(<Probe scrollerEl={scroller} tick={1} />);

    // Math.round(160.6 - 20 + 10) = 151. Measurement runs in useLayoutEffect
    // before the following useLayoutEffect and before any passive useEffect.
    expect(screen.getByTestId("margin")).toHaveTextContent("151");
    expect(events.indexOf("measure")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("measure")).toBeLessThan(events.indexOf("layout:0"));
    expect(events.indexOf("layout:0")).toBeLessThan(
      events.indexOf("layout:151"),
    );
    expect(events.indexOf("layout:151")).toBeLessThan(
      events.indexOf("passive:151"),
    );

    // A re-render with unchanged layout does not trigger an extra state-update render.
    const rendersBeforeSettled = renderCount;
    rerender(<Probe scrollerEl={scroller} tick={2} />);
    expect(renderCount).toBe(rendersBeforeSettled + 1);
    expect(screen.getByTestId("margin")).toHaveTextContent("151");

    // When the container moves on a later render (same scroller & ref identity),
    // the no-deps layout effect updates scrollMargin in layout phase before passive effects.
    containerTop = 95.2;
    scrollerTop = 20;
    scroller.scrollTop = 5;
    events.length = 0;
    rerender(<Probe scrollerEl={scroller} tick={3} />);

    // Math.round(95.2 - 20 + 5) = 80.
    expect(screen.getByTestId("margin")).toHaveTextContent("80");
    expect(events.indexOf("measure")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("measure")).toBeLessThan(
      events.indexOf("layout:151"),
    );
    expect(events.indexOf("layout:80")).toBeLessThan(
      events.indexOf("passive:80"),
    );
  });

  it("no-ops when scroller or container is null and re-measures on Activity reveal", () => {
    const scroller = document.createElement("div");
    let containerTop = 240;
    stubTop(scroller, () => 0);

    function Probe({ scrollerEl }: { scrollerEl: HTMLElement | null }) {
      const containerRef = useRef<HTMLDivElement | null>(null);
      const scrollMargin = useTranscriptViewportScrollMargin(
        scrollerEl,
        containerRef,
      );
      return (
        <div
          ref={(node) => {
            containerRef.current = node;
            if (node) stubTop(node, () => containerTop);
          }}
          data-testid="margin"
        >
          {scrollMargin}
        </div>
      );
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe scrollerEl={null} />
      </Activity>,
    );
    expect(screen.getByTestId("margin")).toHaveTextContent("0");

    rerender(
      <Activity mode="visible">
        <Probe scrollerEl={scroller} />
      </Activity>,
    );
    expect(screen.getByTestId("margin")).toHaveTextContent("240");

    // Hide under Activity, change container offset, then reveal: re-measures.
    rerender(
      <Activity mode="hidden">
        <Probe scrollerEl={scroller} />
      </Activity>,
    );
    containerTop = 100;
    rerender(
      <Activity mode="visible">
        <Probe scrollerEl={scroller} />
      </Activity>,
    );
    expect(screen.getByTestId("margin")).toHaveTextContent("100");
  });
});
