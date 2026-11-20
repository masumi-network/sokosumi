// @vitest-environment happy-dom

import { Activity, act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFocusWhen } from "./use-focus-when";

describe("useFocusWhen (CMO)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("focuses a getter target when condition turns true and re-focuses on resetKey change", async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");

    function Probe({ attempt }: { attempt: number }) {
      const formRef = useRef<HTMLFormElement>(null);
      useFocusWhen(
        () =>
          formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]'),
        attempt !== 0,
        { resetKey: attempt },
      );
      return (
        <form ref={formRef}>
          <input aria-invalid="true" />
        </form>
      );
    }

    await act(async () => root.render(<Probe attempt={0} />));
    expect(focusSpy).not.toHaveBeenCalled();

    await act(async () => root.render(<Probe attempt={1} />));
    expect(focusSpy).toHaveBeenCalledTimes(1);

    // Same attempt does not re-focus.
    await act(async () => root.render(<Probe attempt={1} />));
    expect(focusSpy).toHaveBeenCalledTimes(1);

    // New attempt re-focuses.
    await act(async () => root.render(<Probe attempt={2} />));
    expect(focusSpy).toHaveBeenCalledTimes(2);
  });

  it("does not re-focus when the element remounts with an unchanged condition", async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");

    function Probe({ nodeKey }: { nodeKey: string }) {
      const inputRef = useRef<HTMLInputElement>(null);
      useFocusWhen(inputRef, true);
      return <input key={nodeKey} ref={inputRef} />;
    }

    await act(async () => root.render(<Probe nodeKey="a" />));
    expect(focusSpy).toHaveBeenCalledTimes(1);

    await act(async () => root.render(<Probe nodeKey="b" />));
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it("re-focuses after React Activity hide and reveal", async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");

    function Probe() {
      const ref = useRef<HTMLButtonElement>(null);
      useFocusWhen(ref, true);
      return (
        <button ref={ref} type="button">
          Go
        </button>
      );
    }

    await act(async () =>
      root.render(
        <Activity mode="visible">
          <Probe />
        </Activity>,
      ),
    );
    expect(focusSpy).toHaveBeenCalledTimes(1);

    await act(async () =>
      root.render(
        <Activity mode="hidden">
          <Probe />
        </Activity>,
      ),
    );
    await act(async () =>
      root.render(
        <Activity mode="visible">
          <Probe />
        </Activity>,
      ),
    );
    expect(focusSpy).toHaveBeenCalledTimes(2);
  });

  it("does not throw during SSR", () => {
    function Probe() {
      const ref = useRef<HTMLInputElement>(null);
      useFocusWhen(ref, true);
      return <input ref={ref} />;
    }

    expect(renderToString(<Probe />)).toBe("<input/>");
  });
});
