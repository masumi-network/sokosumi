import { act, render, renderHook } from "@testing-library/react";
import { Activity, useEffect, useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFocusWhen, useLayoutFocusWhen } from "./use-focus-when";

describe("useFocusWhen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("focuses a live element when condition is true and skips when false", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const focusSpy = vi.spyOn(input, "focus");

    const { rerender } = renderHook(
      ({ when }: { when: boolean }) => useFocusWhen(input, when),
      { initialProps: { when: false } },
    );

    expect(focusSpy).not.toHaveBeenCalled();

    rerender({ when: true });
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenLastCalledWith();

    // Unrelated re-render with the same element and condition does not re-focus.
    rerender({ when: true });
    expect(focusSpy).toHaveBeenCalledTimes(1);

    input.remove();
  });

  it("forwards preventScroll option when provided", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const focusSpy = vi.spyOn(button, "focus");

    renderHook(() => useFocusWhen(button, true, { preventScroll: true }));

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });

    button.remove();
  });

  it("focuses a late-mounted element through a callback ref", () => {
    function Probe({ show }: { show: boolean }) {
      const [input, setInput] = useState<HTMLInputElement | null>(null);
      useFocusWhen(input, true);
      return show ? <input ref={setInput} aria-label="Target" /> : null;
    }

    const { rerender, getByLabelText } = render(<Probe show={false} />);
    expect(document.activeElement).toBe(document.body);

    rerender(<Probe show />);
    expect(document.activeElement).toBe(getByLabelText("Target"));
  });

  it("re-focuses when resetKey changes while condition stays true", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const focusSpy = vi.spyOn(input, "focus");

    const { rerender } = renderHook(
      ({ resetKey }: { resetKey: string }) =>
        useFocusWhen(input, true, { resetKey }),
      { initialProps: { resetKey: "a" } },
    );

    expect(focusSpy).toHaveBeenCalledTimes(1);

    rerender({ resetKey: "a" });
    expect(focusSpy).toHaveBeenCalledTimes(1);

    rerender({ resetKey: "b" });
    expect(focusSpy).toHaveBeenCalledTimes(2);

    input.remove();
  });

  it("defers focus to requestAnimationFrame and cancels on unmount or false condition", () => {
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

    const { rerender, unmount } = renderHook(
      ({ when }: { when: boolean }) =>
        useFocusWhen(input, when, { deferToFrame: true }),
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
      const [button, setButton] = useState<HTMLButtonElement | null>(null);
      useFocusWhen(button, true);
      return (
        <button ref={setButton} type="button">
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
      useFocusWhen(null, true, { deferToFrame: true });
      useLayoutFocusWhen(null, true);
      return <span>ok</span>;
    }

    expect(renderToString(<Probe />)).toBe("<span>ok</span>");
  });
});

describe("useLayoutFocusWhen", () => {
  it("focuses during the layout phase before passive effects run", () => {
    const order: string[] = [];
    const target = {
      focus: () => {
        order.push("layout-focus");
      },
    };

    function Probe({ when }: { when: boolean }) {
      useLayoutFocusWhen(target, when);
      useEffect(() => {
        if (when) order.push("passive-effect");
      }, [when]);
      return null;
    }

    const { rerender } = render(<Probe when={false} />);
    expect(order).toEqual([]);

    rerender(<Probe when />);
    expect(order).toEqual(["layout-focus", "passive-effect"]);
  });
});
