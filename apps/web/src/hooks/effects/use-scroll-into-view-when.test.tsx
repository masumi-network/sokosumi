import { render, renderHook } from "@testing-library/react";
import { Activity, useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useScrollIntoViewWhen } from "./use-scroll-into-view-when";

describe("useScrollIntoViewWhen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("scrolls a live element into view with options when condition turns true", () => {
    const element = document.createElement("div");
    const scrollSpy = vi.fn();
    element.scrollIntoView = scrollSpy;

    const { rerender } = renderHook(
      ({ when }: { when: boolean }) =>
        useScrollIntoViewWhen(element, when, {
          block: "center",
          inline: "nearest",
        }),
      { initialProps: { when: false } },
    );

    expect(scrollSpy).not.toHaveBeenCalled();

    rerender({ when: true });
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
    });

    // Unrelated re-render with unchanged deps does not re-scroll.
    rerender({ when: true });
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("re-scrolls when resetKey changes while condition stays true", () => {
    const element = document.createElement("div");
    const scrollSpy = vi.fn();
    element.scrollIntoView = scrollSpy;

    const { rerender } = renderHook(
      ({ resetKey }: { resetKey: number }) =>
        useScrollIntoViewWhen(element, true, {
          block: "nearest",
          resetKey,
        }),
      { initialProps: { resetKey: 0 } },
    );

    expect(scrollSpy).toHaveBeenCalledTimes(1);

    rerender({ resetKey: 1 });
    expect(scrollSpy).toHaveBeenCalledTimes(2);
    expect(scrollSpy).toHaveBeenLastCalledWith({ block: "nearest" });
  });

  it("switches smooth scrolling to auto when respectReducedMotion is set and reduced motion matches", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

    const element = document.createElement("li");
    const scrollSpy = vi.fn();
    element.scrollIntoView = scrollSpy;

    renderHook(() =>
      useScrollIntoViewWhen(element, true, {
        block: "center",
        behavior: "smooth",
        respectReducedMotion: true,
      }),
    );

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({
      block: "center",
      behavior: "auto",
    });
  });

  it("keeps smooth scrolling when respectReducedMotion is set and reduced motion is off", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

    const element = document.createElement("li");
    const scrollSpy = vi.fn();
    element.scrollIntoView = scrollSpy;

    renderHook(() =>
      useScrollIntoViewWhen(element, true, {
        block: "center",
        behavior: "smooth",
        respectReducedMotion: true,
      }),
    );

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({
      block: "center",
      behavior: "smooth",
    });
  });

  it("scrolls a late-mounted element through a callback ref and re-runs on Activity reveal", () => {
    const scrollSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy;

    try {
      function Probe({ show }: { show: boolean }) {
        const [item, setItem] = useState<HTMLDivElement | null>(null);
        useScrollIntoViewWhen(item, true, { block: "nearest" });
        return show ? <div ref={setItem}>target</div> : null;
      }

      const { rerender } = render(
        <Activity mode="visible">
          <Probe show={false} />
        </Activity>,
      );
      expect(scrollSpy).not.toHaveBeenCalled();

      rerender(
        <Activity mode="visible">
          <Probe show />
        </Activity>,
      );
      expect(scrollSpy).toHaveBeenCalledTimes(1);

      rerender(
        <Activity mode="hidden">
          <Probe show />
        </Activity>,
      );
      rerender(
        <Activity mode="visible">
          <Probe show />
        </Activity>,
      );
      expect(scrollSpy).toHaveBeenCalledTimes(2);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("does not throw during SSR", () => {
    function Probe() {
      useScrollIntoViewWhen(null, true, { block: "center" });
      return <span>ok</span>;
    }

    expect(renderToString(<Probe />)).toBe("<span>ok</span>");
  });
});
