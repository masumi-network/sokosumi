import { act, render, renderHook } from "@testing-library/react";
import { createElement, useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useLayoutResizeObserver,
  useResizeObserver,
} from "./use-resize-observer";

interface MockResizeObserverInstance {
  callback: ResizeObserverCallback;
  observed: Element[];
  disconnected: boolean;
  optionsByTarget: Map<Element, ResizeObserverOptions | undefined>;
}

describe("useResizeObserver", () => {
  let instances: MockResizeObserverInstance[];

  beforeEach(() => {
    instances = [];
    class MockResizeObserver implements ResizeObserver {
      private record: MockResizeObserverInstance;

      constructor(callback: ResizeObserverCallback) {
        this.record = {
          callback,
          observed: [],
          disconnected: false,
          optionsByTarget: new Map(),
        };
        instances.push(this.record);
      }

      observe(target: Element, options?: ResizeObserverOptions) {
        this.record.observed.push(target);
        this.record.optionsByTarget.set(target, options);
      }

      unobserve(target: Element) {
        this.record.observed = this.record.observed.filter((t) => t !== target);
      }

      disconnect() {
        this.record.disconnected = true;
        this.record.observed = [];
      }
    }

    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function triggerResize(
    instance: MockResizeObserverInstance,
    width: number,
    height = 100,
  ) {
    act(() => {
      instance.callback(
        [
          {
            contentRect: { width, height } as DOMRectReadOnly,
          } as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    });
  }

  it("observes a live element, forwards entries, and disconnects on unmount", () => {
    const element = document.createElement("div");
    const onResize = vi.fn();

    const { unmount } = renderHook(() => useResizeObserver(element, onResize));

    expect(instances).toHaveLength(1);
    expect(instances[0]?.observed).toEqual([element]);

    triggerResize(instances[0]!, 320);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize.mock.calls[0]?.[0]?.[0]?.contentRect.width).toBe(320);

    unmount();
    expect(instances[0]?.disconnected).toBe(true);
  });

  it("uses the latest callback without re-subscribing", () => {
    const element = document.createElement("div");
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(
      ({ cb }: { cb: (entries: ResizeObserverEntry[]) => void }) =>
        useResizeObserver(element, cb),
      { initialProps: { cb: first } },
    );

    expect(instances).toHaveLength(1);

    rerender({ cb: second });
    expect(instances).toHaveLength(1);

    triggerResize(instances[0]!, 500);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("attaches to late-mounted elements and disconnects when removed or swapped", () => {
    const onResize = vi.fn();

    function Probe({ show, nodeKey }: { show: boolean; nodeKey: string }) {
      const [node, setNode] = useState<HTMLDivElement | null>(null);
      useResizeObserver(node, onResize);
      return show
        ? createElement("div", {
            key: nodeKey,
            ref: setNode,
            "data-testid": "box",
          })
        : null;
    }

    const { rerender } = render(
      createElement(Probe, { show: false, nodeKey: "a" }),
    );
    expect(instances).toHaveLength(0);

    rerender(createElement(Probe, { show: true, nodeKey: "a" }));
    expect(instances).toHaveLength(1);
    const firstObserver = instances[0]!;
    expect(firstObserver.disconnected).toBe(false);

    rerender(createElement(Probe, { show: true, nodeKey: "b" }));
    expect(firstObserver.disconnected).toBe(true);
    expect(instances).toHaveLength(2);
    expect(instances[1]?.disconnected).toBe(false);

    rerender(createElement(Probe, { show: false, nodeKey: "b" }));
    expect(instances[1]?.disconnected).toBe(true);
  });

  it("resolves selector targets without re-subscribing on rerender", () => {
    const host = document.createElement("div");
    host.setAttribute("data-test-resize-host", "");
    document.body.append(host);

    const onResize = vi.fn();
    const { rerender, unmount } = renderHook(() =>
      useResizeObserver({ selector: "[data-test-resize-host]" }, onResize),
    );

    expect(instances).toHaveLength(1);
    expect(instances[0]?.observed).toEqual([host]);

    rerender();
    expect(instances).toHaveLength(1);

    unmount();
    expect(instances[0]?.disconnected).toBe(true);
    host.remove();
  });

  it("observes multiple targets and direct children when requested", () => {
    const parent = document.createElement("div");
    const childA = document.createElement("span");
    const childB = document.createElement("span");
    parent.append(childA, childB);
    const other = document.createElement("section");

    const targets = [parent, other] as const;
    renderHook(() =>
      useResizeObserver(targets, vi.fn(), { observeChildren: true }),
    );

    expect(instances).toHaveLength(1);
    expect(instances[0]?.observed).toEqual([parent, childA, childB, other]);
  });

  it("runs immediate measurement on attach and resetKey change, including when ResizeObserver is unavailable", () => {
    const element = document.createElement("div");
    const onResize = vi.fn();

    const { rerender } = renderHook(
      ({ resetKey }: { resetKey: string }) =>
        useResizeObserver(element, onResize, { immediate: true, resetKey }),
      { initialProps: { resetKey: "v1" } },
    );

    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenLastCalledWith([]);

    rerender({ resetKey: "v2" });
    expect(onResize).toHaveBeenCalledTimes(2);
    expect(instances).toHaveLength(2);
    expect(instances[0]?.disconnected).toBe(true);

    vi.stubGlobal("ResizeObserver", undefined);
    const fallback = vi.fn();
    renderHook(() => useResizeObserver(element, fallback, { immediate: true }));
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("coalesces burst resizes into one animation frame and cancels on unmount", () => {
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.set(++frameId, cb);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });

    const element = document.createElement("div");
    const onResize = vi.fn();

    const { unmount } = renderHook(() =>
      useResizeObserver(element, onResize, { coalesceFrame: true }),
    );

    triggerResize(instances[0]!, 300);
    triggerResize(instances[0]!, 400);
    expect(onResize).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);

    act(() => {
      for (const cb of [...frames.values()]) {
        frames.clear();
        cb(16);
      }
    });
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize.mock.calls[0]?.[0]?.[0]?.contentRect.width).toBe(400);

    triggerResize(instances[0]!, 500);
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it("supports layout timing via useLayoutResizeObserver", () => {
    const element = document.createElement("div");
    const onResize = vi.fn();

    const { unmount } = renderHook(() =>
      useLayoutResizeObserver(element, onResize, { immediate: true }),
    );

    expect(onResize).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.observed).toEqual([element]);

    unmount();
    expect(instances[0]?.disconnected).toBe(true);
  });

  it("renders safely on the server without throwing", () => {
    function ServerProbe() {
      useResizeObserver({ selector: "[data-missing]" }, () => {});
      return createElement("div", null, "ok");
    }

    expect(() => renderToString(createElement(ServerProbe))).not.toThrow();
  });
});
