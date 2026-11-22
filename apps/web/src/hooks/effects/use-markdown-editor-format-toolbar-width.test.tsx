import { render } from "@testing-library/react";
import { Activity, StrictMode, useEffect, useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  FORMAT_TOOLBAR_FALLBACK_WIDTH_PX,
  useMarkdownEditorFormatToolbarWidth,
} from "./use-markdown-editor-format-toolbar-width";

function makeRect(left = 40): DOMRect {
  return {
    x: left,
    y: 40,
    top: 40,
    left,
    width: 80,
    height: 16,
    bottom: 56,
    right: left + 80,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

describe("useMarkdownEditorFormatToolbarWidth", () => {
  it("measures toolbar width in a layout effect before an earlier-registered passive probe runs", () => {
    const order: string[] = [];
    let measuredWidth = 312;
    const captured: { width: number } = { width: 0 };

    function Probe({ selectionRect }: { selectionRect: DOMRect | null }) {
      const toolbarRef = useRef<HTMLDivElement>(null);
      // Register passive probe BEFORE the layout hook so a passive substitution
      // would run this probe before measuring.
      useEffect(() => {
        order.push("passive-probe");
      }, [selectionRect]);

      const width = useMarkdownEditorFormatToolbarWidth(
        toolbarRef,
        selectionRect,
      );
      captured.width = width;

      return (
        <div
          ref={(node) => {
            toolbarRef.current = node;
            if (node) {
              node.getBoundingClientRect = vi.fn(() => {
                order.push("measure");
                return { width: measuredWidth } as DOMRect;
              });
            }
          }}
        />
      );
    }

    const { rerender, unmount } = render(<Probe selectionRect={null} />);
    expect(order).toEqual(["passive-probe"]);
    expect(captured.width).toBe(FORMAT_TOOLBAR_FALLBACK_WIDTH_PX);

    order.length = 0;
    const rect1 = makeRect(40);
    rerender(<Probe selectionRect={rect1} />);
    // Layout measurement runs strictly before the earlier-registered passive probe.
    expect(order).toEqual(["measure", "passive-probe"]);
    expect(captured.width).toBe(312);

    // Zero width leaves previous measured width intact.
    measuredWidth = 0;
    const rect2 = makeRect(80);
    rerender(<Probe selectionRect={rect2} />);
    expect(captured.width).toBe(312);

    // Next non-zero width updates cleanly.
    measuredWidth = 280;
    const rect3 = makeRect(120);
    rerender(<Probe selectionRect={rect3} />);
    expect(captured.width).toBe(280);

    unmount();
  });

  it("matches StrictMode replay and Activity hide/reveal measurements", () => {
    let rectWidth = 300;
    const measureCalls: number[] = [];
    const observed: number[] = [];

    function Probe({ selectionRect }: { selectionRect: DOMRect | null }) {
      const toolbarRef = useRef<HTMLDivElement>(null);
      const width = useMarkdownEditorFormatToolbarWidth(
        toolbarRef,
        selectionRect,
      );
      observed.push(width);
      return (
        <div
          ref={(node) => {
            toolbarRef.current = node;
            if (node) {
              node.getBoundingClientRect = () => {
                measureCalls.push(rectWidth);
                return { width: rectWidth } as DOMRect;
              };
            }
          }}
        />
      );
    }

    const rect = makeRect(40);
    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe selectionRect={rect} />
        </Activity>
      </StrictMode>,
    );
    expect(observed.at(-1)).toBe(300);
    expect(measureCalls.length).toBeGreaterThanOrEqual(2);

    measureCalls.length = 0;
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe selectionRect={rect} />
        </Activity>
      </StrictMode>,
    );
    expect(measureCalls).toEqual([]);

    rectWidth = 340;
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe selectionRect={rect} />
        </Activity>
      </StrictMode>,
    );
    expect(observed.at(-1)).toBe(340);
    expect(measureCalls.length).toBeGreaterThanOrEqual(1);

    unmount();
  });
});
