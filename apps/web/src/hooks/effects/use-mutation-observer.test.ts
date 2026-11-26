import { act, render, renderHook } from "@testing-library/react";
import { createElement, useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLayoutMutationObserver } from "./use-mutation-observer";

interface MockMutationObserverInstance {
  callback: MutationCallback;
  target: Node | null;
  init: MutationObserverInit | undefined;
  disconnected: boolean;
}

describe("useLayoutMutationObserver", () => {
  let instances: MockMutationObserverInstance[];

  beforeEach(() => {
    instances = [];
    class MockMutationObserver implements MutationObserver {
      private record: MockMutationObserverInstance;

      constructor(callback: MutationCallback) {
        this.record = {
          callback,
          target: null,
          init: undefined,
          disconnected: false,
        };
        instances.push(this.record);
      }

      observe(target: Node, options?: MutationObserverInit) {
        this.record.target = target;
        this.record.init = options;
      }

      disconnect() {
        this.record.disconnected = true;
      }

      takeRecords(): MutationRecord[] {
        return [];
      }
    }

    vi.stubGlobal("MutationObserver", MockMutationObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function triggerMutation(instance: MockMutationObserverInstance) {
    act(() => {
      instance.callback(
        [{ type: "childList" } as MutationRecord],
        {} as MutationObserver,
      );
    });
  }

  it("observes a live node, forwards every batch, and disconnects on unmount", () => {
    const node = document.createElement("div");
    const onMutate = vi.fn();

    const { unmount } = renderHook(() =>
      useLayoutMutationObserver(node, onMutate, {
        init: { childList: true, subtree: true },
      }),
    );

    expect(instances).toHaveLength(1);
    expect(instances[0]?.target).toBe(node);
    expect(instances[0]?.init).toEqual({ childList: true, subtree: true });

    triggerMutation(instances[0]!);
    triggerMutation(instances[0]!);
    expect(onMutate).toHaveBeenCalledTimes(2);

    unmount();
    expect(instances[0]?.disconnected).toBe(true);
  });

  it("resolves body and documentElement targets and keeps inline init stable", () => {
    const first = vi.fn();
    const second = vi.fn();

    const { rerender, unmount } = renderHook(
      ({ cb }: { cb: (records: MutationRecord[]) => void }) =>
        useLayoutMutationObserver("body", cb, {
          init: {
            attributes: true,
            attributeFilter: ["class", "style"],
          },
        }),
      { initialProps: { cb: first } },
    );

    expect(instances).toHaveLength(1);
    expect(instances[0]?.target).toBe(document.body);
    expect(instances[0]?.init).toEqual({
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    rerender({ cb: second });
    expect(instances).toHaveLength(1);

    triggerMutation(instances[0]!);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    unmount();
    expect(instances[0]?.disconnected).toBe(true);

    const docHook = renderHook(() =>
      useLayoutMutationObserver("documentElement", vi.fn(), {
        init: { attributes: true },
      }),
    );
    expect(instances[1]?.target).toBe(document.documentElement);
    docHook.unmount();
  });

  it("runs immediate callback synchronously and re-runs on resetKey change", () => {
    const node = document.createElement("div");
    const onMutate = vi.fn();

    const { rerender } = renderHook(
      ({ resetKey }: { resetKey: string }) =>
        useLayoutMutationObserver(node, onMutate, {
          init: { childList: true },
          immediate: true,
          resetKey,
        }),
      { initialProps: { resetKey: "a" } },
    );

    expect(onMutate).toHaveBeenCalledTimes(1);
    expect(onMutate).toHaveBeenLastCalledWith([]);

    rerender({ resetKey: "b" });
    expect(onMutate).toHaveBeenCalledTimes(2);
    expect(instances[0]?.disconnected).toBe(true);
    expect(instances).toHaveLength(2);
  });

  it("supports layout timing via useLayoutMutationObserver and late targets", () => {
    const onMutate = vi.fn();

    function Probe({ show }: { show: boolean }) {
      const [node, setNode] = useState<HTMLDivElement | null>(null);
      useLayoutMutationObserver(node, onMutate, {
        init: { childList: true },
        immediate: true,
      });
      return show ? createElement("div", { ref: setNode }) : null;
    }

    const { rerender, unmount } = render(createElement(Probe, { show: false }));
    expect(instances).toHaveLength(0);
    expect(onMutate).not.toHaveBeenCalled();

    rerender(createElement(Probe, { show: true }));
    expect(instances).toHaveLength(1);
    expect(onMutate).toHaveBeenCalledTimes(1);

    unmount();
    expect(instances[0]?.disconnected).toBe(true);
  });

  it("renders safely on the server without throwing", () => {
    function ServerProbe() {
      useLayoutMutationObserver("body", () => {}, {
        init: { childList: true },
      });
      return createElement("div", null, "ok");
    }

    expect(() => renderToString(createElement(ServerProbe))).not.toThrow();
  });
});
