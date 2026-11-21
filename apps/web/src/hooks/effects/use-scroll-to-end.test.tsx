import { render, renderHook } from "@testing-library/react";
import { Activity, useRef } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useScrollToEnd } from "./use-scroll-to-end";

describe("useScrollToEnd", () => {
  it("scrolls vertically to scrollHeight on mount and when trigger changes", () => {
    const container = document.createElement("div");
    let scrollHeight = 400;
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    container.scrollTop = 0;
    const ref = { current: container };

    const { rerender } = renderHook(
      ({ trigger }: { trigger: number }) => useScrollToEnd(ref, trigger),
      { initialProps: { trigger: 1 } },
    );

    expect(container.scrollTop).toBe(400);

    // Unchanged trigger does not overwrite user scroll position.
    container.scrollTop = 120;
    rerender({ trigger: 1 });
    expect(container.scrollTop).toBe(120);

    // Changing trigger scrolls to the new bottom.
    scrollHeight = 760;
    rerender({ trigger: 2 });
    expect(container.scrollTop).toBe(760);
  });

  it("scrolls horizontally to scrollWidth when axis is horizontal", () => {
    const container = document.createElement("div");
    let scrollWidth = 900;
    Object.defineProperty(container, "scrollWidth", {
      configurable: true,
      get: () => scrollWidth,
    });
    container.scrollLeft = 0;
    const ref = { current: container };

    const { rerender } = renderHook(
      ({ trigger }: { trigger: number }) =>
        useScrollToEnd(ref, trigger, { axis: "horizontal" }),
      { initialProps: { trigger: 5 } },
    );

    expect(container.scrollLeft).toBe(900);

    scrollWidth = 1200;
    rerender({ trigger: 6 });
    expect(container.scrollLeft).toBe(1200);
  });

  it("skips scrolling while enabled is false", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      value: 500,
    });
    container.scrollTop = 0;
    const ref = { current: container };

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useScrollToEnd(ref, 1, { enabled }),
      { initialProps: { enabled: false } },
    );

    expect(container.scrollTop).toBe(0);

    rerender({ enabled: true });
    expect(container.scrollTop).toBe(500);
  });

  it("does not re-scroll on element remount when trigger is unchanged, and re-runs on Activity reveal", () => {
    const lastNode: { current: HTMLDivElement | null } = { current: null };

    function Probe({ nodeKey, count }: { nodeKey: string; count: number }) {
      const ref = useRef<HTMLDivElement>(null);
      useScrollToEnd(ref, count);
      return (
        <div
          key={nodeKey}
          ref={(el) => {
            ref.current = el;
            if (el) {
              Object.defineProperty(el, "scrollHeight", {
                configurable: true,
                value: 320,
              });
              lastNode.current = el;
            }
          }}
        />
      );
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe nodeKey="a" count={1} />
      </Activity>,
    );
    expect(lastNode.current?.scrollTop).toBe(320);

    // Remounting the node while `count` is unchanged does not re-scroll.
    rerender(
      <Activity mode="visible">
        <Probe nodeKey="b" count={1} />
      </Activity>,
    );
    expect(lastNode.current?.scrollTop).toBe(0);

    // Activity reveal re-runs the effect and scrolls to end.
    rerender(
      <Activity mode="hidden">
        <Probe nodeKey="b" count={1} />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Probe nodeKey="b" count={1} />
      </Activity>,
    );
    expect(lastNode.current?.scrollTop).toBe(320);
  });

  it("does not throw during SSR", () => {
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      useScrollToEnd(ref, 0);
      return <span ref={ref}>ok</span>;
    }

    expect(renderToString(<Probe />)).toBe("<span>ok</span>");
  });
});
