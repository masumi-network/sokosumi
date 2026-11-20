import { act, render, renderHook } from "@testing-library/react";
import { Activity, useEffect, useRef } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFocusWhen, useLayoutFocusWhen } from "./use-focus-when";

describe("useFocusWhen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("focuses ref.current when condition turns true and skips when false", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const focusSpy = vi.spyOn(input, "focus");
    const ref = { current: input };

    const { rerender } = renderHook(
      ({ when }: { when: boolean }) => useFocusWhen(ref, when),
      { initialProps: { when: false } },
    );

    expect(focusSpy).not.toHaveBeenCalled();

    rerender({ when: true });
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenLastCalledWith();

    // Unrelated re-render with unchanged condition does not re-focus.
    rerender({ when: true });
    expect(focusSpy).toHaveBeenCalledTimes(1);

    input.remove();
  });

  it("forwards preventScroll option when provided", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const focusSpy = vi.spyOn(button, "focus");
    const ref = { current: button };

    renderHook(() => useFocusWhen(ref, true, { preventScroll: true }));

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });

    button.remove();
  });

  it("does not re-focus when the element remounts with an unchanged condition", () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");

    function Probe({ nodeKey }: { nodeKey: string }) {
      const inputRef = useRef<HTMLInputElement>(null);
      useFocusWhen(inputRef, true);
      return <input key={nodeKey} ref={inputRef} aria-label="Target" />;
    }

    const { rerender } = render(<Probe nodeKey="first" />);
    expect(focusSpy).toHaveBeenCalledTimes(1);

    // Replacing the DOM node while `when` stays true does not re-trigger focus.
    rerender(<Probe nodeKey="second" />);
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it("re-focuses when resetKey changes while condition stays true", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const focusSpy = vi.spyOn(input, "focus");
    const ref = { current: input };

    const { rerender } = renderHook(
      ({ resetKey }: { resetKey: string }) =>
        useFocusWhen(ref, true, { resetKey }),
      { initialProps: { resetKey: "a" } },
    );

    expect(focusSpy).toHaveBeenCalledTimes(1);

    rerender({ resetKey: "a" });
    expect(focusSpy).toHaveBeenCalledTimes(1);

    rerender({ resetKey: "b" });
    expect(focusSpy).toHaveBeenCalledTimes(2);

    input.remove();
  });

  it("defers focus to requestAnimationFrame, reads current ref at frame time, and cancels on cleanup", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });

    const input = document.createElement("input");
    document.body.append(input);
    const focusSpy = vi.spyOn(input, "focus");
    const ref = { current: input };

    const { rerender, unmount } = renderHook(
      ({ when }: { when: boolean }) =>
        useFocusWhen(ref, when, { deferToFrame: true }),
      { initialProps: { when: true } },
    );

    expect(focusSpy).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);

    // Flipping condition false cancels the pending animation frame.
    rerender({ when: false });
    expect(frames.size).toBe(0);

    // Re-enabling schedules a new frame and focuses when it runs.
    rerender({ when: true });
    expect(frames.size).toBe(1);
    act(() => {
      for (const cb of [...frames.values()]) {
        cb(16);
      }
      frames.clear();
    });
    expect(focusSpy).toHaveBeenCalledTimes(1);

    // Unmounting cancels any pending frame.
    rerender({ when: false });
    rerender({ when: true });
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);

    input.remove();
  });

  it("re-focuses after React Activity hide and reveal", () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");

    function Probe() {
      const buttonRef = useRef<HTMLButtonElement>(null);
      useFocusWhen(buttonRef, true);
      return (
        <button ref={buttonRef} type="button">
          Go
        </button>
      );
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(focusSpy).toHaveBeenCalledTimes(1);

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
    expect(focusSpy).toHaveBeenCalledTimes(2);
  });

  it("does not throw during SSR", () => {
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      useFocusWhen(ref, true, { deferToFrame: true });
      useLayoutFocusWhen(ref, true);
      return <span ref={ref}>ok</span>;
    }

    expect(renderToString(<Probe />)).toBe("<span>ok</span>");
  });
});

describe("useLayoutFocusWhen", () => {
  it("focuses before a passive sibling effect on mount, condition change, and Activity reveal", () => {
    const order: string[] = [];

    function Sibling({ when }: { when: boolean }) {
      useEffect(() => {
        if (when) order.push("passive-sibling");
      }, [when]);
      return null;
    }

    function Target({ when }: { when: boolean }) {
      const ref = useRef<{ focus: () => void }>({
        focus: () => {
          order.push("layout-focus");
        },
      });
      useLayoutFocusWhen(ref, when);
      return null;
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Target when={false} />
        <Sibling when={false} />
      </Activity>,
    );
    expect(order).toEqual([]);

    rerender(
      <Activity mode="visible">
        <Target when />
        <Sibling when />
      </Activity>,
    );
    expect(order).toEqual(["layout-focus", "passive-sibling"]);

    order.length = 0;
    rerender(
      <Activity mode="hidden">
        <Target when />
        <Sibling when />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Target when />
        <Sibling when />
      </Activity>,
    );
    expect(order).toEqual(["layout-focus", "passive-sibling"]);
  });
});
