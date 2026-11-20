// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEventListener } from "./use-event-listener";

describe("useEventListener (CMO)", () => {
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

  it("fires the handler, uses the latest handler, and removes on unmount", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const first = vi.fn();
    const second = vi.fn();

    function Probe({ handler }: { handler: (event: KeyboardEvent) => void }) {
      useEventListener("window", "keydown", handler);
      return null;
    }

    await act(async () => root.render(<Probe handler={first} />));
    expect(
      addSpy.mock.calls.filter(([type]) => type === "keydown"),
    ).toHaveLength(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(first).toHaveBeenCalledTimes(1);

    await act(async () => root.render(<Probe handler={second} />));
    expect(
      addSpy.mock.calls.filter(([type]) => type === "keydown"),
    ).toHaveLength(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(second).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("removes the listener on target change and toggles off when target is null", async () => {
    const firstTarget = document.createElement("div");
    const secondTarget = document.createElement("div");
    const handler = vi.fn();

    function Probe({ target }: { target: HTMLElement | null }) {
      useEventListener(target, "click", handler);
      return null;
    }

    await act(async () => root.render(<Probe target={firstTarget} />));
    firstTarget.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(1);

    await act(async () => root.render(<Probe target={secondTarget} />));
    firstTarget.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(1);

    secondTarget.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(2);

    await act(async () => root.render(<Probe target={null} />));
    secondTarget.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does not throw during SSR", () => {
    function Probe() {
      useEventListener("window", "popstate", () => {});
      useEventListener("document", "keydown", () => {});
      return <span>ok</span>;
    }

    expect(renderToString(<Probe />)).toBe("<span>ok</span>");
  });
});
