import { act, render, renderHook } from "@testing-library/react";
import { createElement, useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIntersectionObserver } from "./use-intersection-observer";

interface MockIntersectionObserverInstance {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  observed: Element[];
  disconnected: boolean;
}

describe("useIntersectionObserver", () => {
  let instances: MockIntersectionObserverInstance[];

  beforeEach(() => {
    instances = [];
    class MockIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "";
      readonly scrollMargin = "";
      readonly thresholds = [];
      private record: MockIntersectionObserverInstance;

      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        this.record = {
          callback,
          options,
          observed: [],
          disconnected: false,
        };
        instances.push(this.record);
      }

      observe(target: Element) {
        this.record.observed.push(target);
      }

      unobserve(target: Element) {
        this.record.observed = this.record.observed.filter((t) => t !== target);
      }

      disconnect() {
        this.record.disconnected = true;
        this.record.observed = [];
      }

      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function triggerIntersect(
    instance: MockIntersectionObserverInstance,
    isIntersecting: boolean,
  ) {
    act(() => {
      instance.callback(
        [{ isIntersecting } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
  }

  it("observes a live element with options, forwards entries, and disconnects on unmount", () => {
    const element = document.createElement("div");
    const root = document.createElement("section");
    const onIntersect = vi.fn();

    const { unmount } = renderHook(() =>
      useIntersectionObserver(element, onIntersect, {
        root,
        rootMargin: "400px 0px 0px 0px",
        threshold: [0, 0.5],
      }),
    );

    expect(instances).toHaveLength(1);
    expect(instances[0]?.observed).toEqual([element]);
    expect(instances[0]?.options).toEqual({
      root,
      rootMargin: "400px 0px 0px 0px",
      threshold: [0, 0.5],
    });

    triggerIntersect(instances[0]!, true);
    expect(onIntersect).toHaveBeenCalledTimes(1);
    expect(onIntersect.mock.calls[0]?.[0]?.[0]?.isIntersecting).toBe(true);

    unmount();
    expect(instances[0]?.disconnected).toBe(true);
  });

  it("uses the latest callback and stable inline threshold arrays without re-subscribing", () => {
    const element = document.createElement("div");
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(
      ({ cb }: { cb: (entries: IntersectionObserverEntry[]) => void }) =>
        useIntersectionObserver(element, cb, {
          rootMargin: "200px",
          threshold: [0, 1],
        }),
      { initialProps: { cb: first } },
    );

    expect(instances).toHaveLength(1);

    rerender({ cb: second });
    expect(instances).toHaveLength(1);

    triggerIntersect(instances[0]!, true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("re-arms when resetKey changes", () => {
    const element = document.createElement("div");
    const onIntersect = vi.fn();

    const { rerender } = renderHook(
      ({ resetKey }: { resetKey: number }) =>
        useIntersectionObserver(element, onIntersect, { resetKey }),
      { initialProps: { resetKey: 1 } },
    );

    expect(instances).toHaveLength(1);
    expect(instances[0]?.disconnected).toBe(false);

    rerender({ resetKey: 2 });
    expect(instances[0]?.disconnected).toBe(true);
    expect(instances).toHaveLength(2);
    expect(instances[1]?.observed).toEqual([element]);
  });

  it("attaches to late-mounted elements and detaches when target becomes null", () => {
    const onIntersect = vi.fn();

    function Probe({ armed }: { armed: boolean }) {
      const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
      useIntersectionObserver(armed ? sentinel : null, onIntersect);
      return armed ? createElement("div", { ref: setSentinel }) : null;
    }

    const { rerender } = render(createElement(Probe, { armed: false }));
    expect(instances).toHaveLength(0);

    rerender(createElement(Probe, { armed: true }));
    expect(instances).toHaveLength(1);

    rerender(createElement(Probe, { armed: false }));
    expect(instances[0]?.disconnected).toBe(true);
  });

  it("no-ops safely when IntersectionObserver is unavailable or during SSR", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const element = document.createElement("div");

    expect(() =>
      renderHook(() => useIntersectionObserver(element, vi.fn())),
    ).not.toThrow();

    function ServerProbe() {
      useIntersectionObserver(null, () => {});
      return createElement("div", null, "ok");
    }

    expect(() => renderToString(createElement(ServerProbe))).not.toThrow();
  });
});
