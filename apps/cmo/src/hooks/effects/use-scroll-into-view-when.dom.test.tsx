// @vitest-environment happy-dom

import { act, useState } from "react";
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

  it("scrolls a live element when condition turns true and re-scrolls on resetKey change", async () => {
    const element = document.createElement("div");
    const scrollSpy = vi.fn();
    element.scrollIntoView = scrollSpy;

    function Probe({ when, resetKey }: { when: boolean; resetKey: number }) {
      useScrollIntoViewWhen(element, when, { block: "end", resetKey });
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

  it("scrolls a late-mounted element through a callback ref", async () => {
    const scrollSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy;

    try {
      function Probe({ show }: { show: boolean }) {
        const [node, setNode] = useState<HTMLParagraphElement | null>(null);
        useScrollIntoViewWhen(node, show, { block: "nearest" });
        return show ? <p ref={setNode}>alert</p> : null;
      }

      await act(async () => root.render(<Probe show={false} />));
      expect(scrollSpy).not.toHaveBeenCalled();

      await act(async () => root.render(<Probe show />));
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("does not throw during SSR", () => {
    function Probe() {
      useScrollIntoViewWhen(null, true, { block: "nearest" });
      return <span>ok</span>;
    }

    expect(renderToString(<Probe />)).toBe("<span>ok</span>");
  });
});
