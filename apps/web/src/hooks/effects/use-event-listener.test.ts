import { render, renderHook } from "@testing-library/react";
import { createElement, useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useEventListener } from "./use-event-listener";

describe("useEventListener", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires the handler when the event dispatches on window", () => {
    const handler = vi.fn();
    renderHook(() => useEventListener("window", "keydown", handler));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toBeInstanceOf(KeyboardEvent);
    expect((handler.mock.calls[0]?.[0] as KeyboardEvent).key).toBe("k");
  });

  it("uses the latest handler without re-subscribing", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(
      ({ handler }: { handler: (event: KeyboardEvent) => void }) =>
        useEventListener("window", "keydown", handler),
      { initialProps: { handler: first } },
    );

    const initialCalls = addSpy.mock.calls.filter(
      ([type]) => type === "keydown",
    ).length;
    expect(initialCalls).toBe(1);

    rerender({ handler: second });

    const afterRerenderCalls = addSpy.mock.calls.filter(
      ([type]) => type === "keydown",
    ).length;
    expect(afterRerenderCalls).toBe(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("removes the listener on unmount", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useEventListener("document", "keydown", handler),
    );

    unmount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

    expect(handler).not.toHaveBeenCalled();
  });

  it("removes the listener from the previous target and attaches to the new target", () => {
    const firstTarget = document.createElement("div");
    const secondTarget = document.createElement("div");
    const handler = vi.fn();

    const { rerender } = renderHook(
      ({ target }: { target: HTMLElement | null }) =>
        useEventListener(target, "click", handler),
      { initialProps: { target: firstTarget as HTMLElement | null } },
    );

    firstTarget.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(1);

    rerender({ target: secondTarget });

    firstTarget.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(1);

    secondTarget.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(2);

    rerender({ target: null });
    secondTarget.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("attaches to an element mounted after initial render and re-attaches when a keyed element is replaced", () => {
    const handler = vi.fn();

    function Probe({ show, nodeKey }: { show: boolean; nodeKey: string }) {
      const [button, setButton] = useState<HTMLButtonElement | null>(null);
      useEventListener(button, "click", handler);
      return show
        ? createElement("button", {
            key: nodeKey,
            ref: setButton,
            type: "button",
            "data-testid": "target",
          })
        : null;
    }

    const { rerender, queryByTestId } = render(
      createElement(Probe, { show: false, nodeKey: "first" }),
    );
    expect(queryByTestId("target")).toBeNull();

    // Late attachment: element mounts after the initial null render.
    rerender(createElement(Probe, { show: true, nodeKey: "first" }));
    const firstNode = queryByTestId("target") as HTMLButtonElement;
    firstNode.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(1);

    // Keyed replacement: detaches from the old node and attaches to the new one.
    rerender(createElement(Probe, { show: true, nodeKey: "second" }));
    const secondNode = queryByTestId("target") as HTMLButtonElement;
    expect(secondNode).not.toBe(firstNode);

    firstNode.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(1);

    secondNode.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("forwards listener options without re-subscribing on equal inline options", () => {
    const button = document.createElement("button");
    const addSpy = vi.spyOn(button, "addEventListener");
    const removeSpy = vi.spyOn(button, "removeEventListener");
    const handler = vi.fn();

    const { rerender, unmount } = renderHook(
      ({ passive }: { passive: boolean }) =>
        useEventListener(button, "click", handler, { capture: true, passive }),
      { initialProps: { passive: false } },
    );

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith("click", expect.any(Function), {
      capture: true,
      passive: false,
    });

    // Re-rendering with a fresh object holding the same flags does not re-attach.
    rerender({ passive: false });
    expect(addSpy).toHaveBeenCalledTimes(1);

    button.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(1);

    unmount();
    expect(removeSpy).toHaveBeenCalledWith("click", expect.any(Function), true);
  });

  it("forwards boolean capture options to addEventListener and removeEventListener", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const handler = vi.fn();

    const { unmount } = renderHook(() =>
      useEventListener("document", "click", handler, true),
    );

    expect(addSpy).toHaveBeenCalledWith("click", expect.any(Function), true);
    document.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(1);

    unmount();
    expect(removeSpy).toHaveBeenCalledWith("click", expect.any(Function), true);
  });

  it("does not throw during SSR when targeting window or document", () => {
    function Probe() {
      useEventListener("window", "resize", () => {});
      useEventListener("document", "visibilitychange", () => {});
      return createElement("span", null, "ok");
    }

    expect(renderToString(createElement(Probe))).toBe("<span>ok</span>");
  });
});
