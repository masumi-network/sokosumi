// @vitest-environment happy-dom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScrollIntoViewWhen } from "./use-scroll-into-view-when";

describe("useScrollIntoViewWhen (CMO)", () => {
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

  it("scrolls ref.current when condition turns true and re-scrolls on resetKey change", async () => {
    const element = document.createElement("div");
    const scrollSpy = vi.fn();
    element.scrollIntoView = scrollSpy;
    const ref = { current: element };

    function Probe({ when, resetKey }: { when: boolean; resetKey: number }) {
      useScrollIntoViewWhen(ref, when, { block: "end", resetKey });
      return null;
    }

    await act(async () => root.render(<Probe when={false} resetKey={0} />));
    expect(scrollSpy).not.toHaveBeenCalled();

    await act(async () => root.render(<Probe when resetKey={0} />));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ block: "end" });

    await act(async () => root.render(<Probe when resetKey={1} />));
    expect(scrollSpy).toHaveBeenCalledTimes(2);
  });

  it("does not re-scroll on element remount when condition is unchanged", async () => {
    const scrollSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy;

    try {
      function Probe({ nodeKey }: { nodeKey: string }) {
        const ref = useRef<HTMLParagraphElement>(null);
        useScrollIntoViewWhen(ref, true, { block: "nearest" });
        return (
          <p key={nodeKey} ref={ref}>
            alert
          </p>
        );
      }

      await act(async () => root.render(<Probe nodeKey="a" />));
      expect(scrollSpy).toHaveBeenCalledTimes(1);

      await act(async () => root.render(<Probe nodeKey="b" />));
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("scrolls only the new target exactly once when a getter target changes", async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute("data-id") ?? "");
    };

    try {
      function Probe({ active }: { active: string }) {
        const listRef = useRef<HTMLDivElement>(null);
        useScrollIntoViewWhen(
          () => listRef.current?.querySelector(`[data-id="${active}"]`),
          true,
          { block: "nearest", resetKey: active },
        );
        return (
          <div ref={listRef}>
            <div data-id="one">1</div>
            <div data-id="two">2</div>
          </div>
        );
      }

      await act(async () => root.render(<Probe active="one" />));
      expect(scrolled).toEqual(["one"]);

      scrolled.length = 0;
      await act(async () => root.render(<Probe active="two" />));
      expect(scrolled).toEqual(["two"]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("does not throw during SSR", () => {
    function Probe() {
      const ref = useRef<HTMLSpanElement>(null);
      useScrollIntoViewWhen(ref, true, { block: "nearest" });
      return <span ref={ref}>ok</span>;
    }

    expect(renderToString(<Probe />)).toBe("<span>ok</span>");
  });
});
