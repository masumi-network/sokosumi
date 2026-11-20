import { render, renderHook } from "@testing-library/react";
import { Activity, useCallback, useState } from "react";
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

    const { rerender } = renderHook(
      ({ trigger }: { trigger: number }) => useScrollToEnd(container, trigger),
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

    const { rerender } = renderHook(
      ({ trigger }: { trigger: number }) =>
        useScrollToEnd(container, trigger, { axis: "horizontal" }),
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

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useScrollToEnd(container, 1, { enabled }),
      { initialProps: { enabled: false } },
    );

    expect(container.scrollTop).toBe(0);

    rerender({ enabled: true });
    expect(container.scrollTop).toBe(500);
  });

  it("scrolls a late-mounted container and re-runs on Activity reveal", () => {
    const attached: { current: HTMLDivElement | null } = { current: null };

    function Probe({ show, count }: { show: boolean; count: number }) {
      const [node, setNode] = useState<HTMLDivElement | null>(null);
      const attach = useCallback((el: HTMLDivElement | null) => {
        if (el) {
          Object.defineProperty(el, "scrollHeight", {
            configurable: true,
            value: 320,
          });
        }
        attached.current = el;
        setNode(el);
      }, []);
      useScrollToEnd(node, count);
      return show ? <div ref={attach} /> : null;
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe show={false} count={1} />
      </Activity>,
    );
    expect(attached.current).toBeNull();

    rerender(
      <Activity mode="visible">
        <Probe show count={1} />
      </Activity>,
    );
    expect(attached.current?.scrollTop).toBe(320);

    if (attached.current) attached.current.scrollTop = 40;
    rerender(
      <Activity mode="hidden">
        <Probe show count={1} />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Probe show count={1} />
      </Activity>,
    );
    expect(attached.current?.scrollTop).toBe(320);
  });

  it("does not throw during SSR", () => {
    function Probe() {
      useScrollToEnd(null, 0);
      return <span>ok</span>;
    }

    expect(renderToString(<Probe />)).toBe("<span>ok</span>");
  });
});
