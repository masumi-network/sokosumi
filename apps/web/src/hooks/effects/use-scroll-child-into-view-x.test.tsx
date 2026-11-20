import { render } from "@testing-library/react";
import { Activity, useRef } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { useScrollChildIntoViewX } from "./use-scroll-child-into-view-x";

function rect(left: number, right: number): DOMRect {
  return {
    left,
    right,
    top: 0,
    bottom: 40,
    width: right - left,
    height: 40,
    x: left,
    y: 0,
    toJSON: () => ({}),
  };
}

describe("useScrollChildIntoViewX", () => {
  it("adjusts container scrollLeft when the matched child overflows right, overflows left, or is already visible", () => {
    const barBox = { current: null as HTMLDivElement | null };

    function Probe({ active }: { active: string | null }) {
      const barRef = useRef<HTMLDivElement>(null);
      useScrollChildIntoViewX(
        barRef,
        () =>
          active
            ? barRef.current?.querySelector<HTMLElement>(
                `[data-id="${active}"]`,
              )
            : null,
        active,
      );
      return (
        <div
          ref={(node) => {
            barRef.current = node;
            barBox.current = node;
          }}
        >
          <button type="button" data-id="left">
            Left
          </button>
          <button type="button" data-id="middle">
            Middle
          </button>
          <button type="button" data-id="right">
            Right
          </button>
        </div>
      );
    }

    const { rerender } = render(<Probe active={null} />);
    const bar = barBox.current;
    if (!bar) throw new Error("expected bar");
    bar.scrollLeft = 100;
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(rect(0, 200));

    const leftEl = bar.querySelector<HTMLElement>('[data-id="left"]');
    const middleEl = bar.querySelector<HTMLElement>('[data-id="middle"]');
    const rightEl = bar.querySelector<HTMLElement>('[data-id="right"]');
    if (!leftEl || !middleEl || !rightEl) throw new Error("expected buttons");

    vi.spyOn(leftEl, "getBoundingClientRect").mockReturnValue(rect(-35, 25));
    vi.spyOn(middleEl, "getBoundingClientRect").mockReturnValue(rect(40, 120));
    vi.spyOn(rightEl, "getBoundingClientRect").mockReturnValue(rect(180, 260));

    // Overflows right by 60px -> scrollLeft increases by 60.
    rerender(<Probe active="right" />);
    expect(bar.scrollLeft).toBe(160);

    // Unchanged trigger does not scroll again even if rects still overflow.
    rerender(<Probe active="right" />);
    expect(bar.scrollLeft).toBe(160);

    // Already inside container bounds -> scrollLeft untouched.
    rerender(<Probe active="middle" />);
    expect(bar.scrollLeft).toBe(160);

    // Overflows left by 35px -> scrollLeft decreases by 35.
    rerender(<Probe active="left" />);
    expect(bar.scrollLeft).toBe(125);
  });

  it("re-runs on React Activity reveal and does not throw during SSR", () => {
    const barBox = { current: null as HTMLDivElement | null };

    function Probe({ active }: { active: string }) {
      const barRef = useRef<HTMLDivElement>(null);
      useScrollChildIntoViewX(
        barRef,
        () =>
          barRef.current?.querySelector<HTMLElement>(`[data-id="${active}"]`),
        active,
      );
      return (
        <div
          ref={(node) => {
            barRef.current = node;
            barBox.current = node;
          }}
        >
          <span data-id="a">A</span>
        </div>
      );
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe active="a" />
      </Activity>,
    );
    const bar = barBox.current;
    if (!bar) throw new Error("expected bar");
    const child = bar.querySelector<HTMLElement>('[data-id="a"]');
    if (!child) throw new Error("expected child");
    bar.scrollLeft = 0;
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(rect(0, 100));
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue(rect(90, 140));

    rerender(
      <Activity mode="hidden">
        <Probe active="a" />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Probe active="a" />
      </Activity>,
    );
    expect(bar.scrollLeft).toBe(40);

    expect(renderToString(<Probe active="a" />)).toContain("A");
  });
});
