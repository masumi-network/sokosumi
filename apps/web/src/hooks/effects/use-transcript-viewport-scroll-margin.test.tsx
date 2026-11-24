import type { ChatRoomMessage } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { Activity, createRef, useEffect, useLayoutEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TranscriptViewport,
  type TranscriptViewportHandle,
} from "@/app/chat/components/transcript-viewport";
import type { RoomTranscriptRenderRow } from "@/app/chat/utils/room-transcript-ranges";
import { estimateTranscriptRowHeight } from "@/app/chat/utils/transcript-viewport-model";
import {
  useTranscriptViewportScrollMargin,
  useTranscriptViewportScrollMarginState,
} from "./use-transcript-viewport-scroll-margin";

const observedVirtualizerScrollMargins: number[] = [];

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: ((options: Parameters<typeof actual.useVirtualizer>[0]) => {
      observedVirtualizerScrollMargins.push(options.scrollMargin ?? 0);
      return actual.useVirtualizer(options);
    }) as typeof actual.useVirtualizer,
  };
});

function makeRow(index: number): RoomTranscriptRenderRow {
  const message: ChatRoomMessage = {
    id: `msg-${index}`,
    roomId: "room-1",
    parentMessageId: null,
    content: `Message ${index}`,
    createdAt: new Date(Date.UTC(2026, 10, 24, 10, 0, index)),
    deletedAt: null,
    editedAt: null,
    pinnedAt: null,
    sender: { type: "unknown" },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    groupNameChange: null,
    unfurls: null,
  };
  return {
    kind: "message",
    message,
    previousMessage: undefined,
    dayPreviousMessage: undefined,
  };
}

function stubTop(element: Element, getTop: () => number) {
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        top: getTop(),
        bottom: getTop(),
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: getTop(),
        toJSON: () => ({}),
      }) as DOMRect,
  );
}

describe("useTranscriptViewportScrollMargin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("measures rounded container offset in layout phase before passive effects and updates on later renders when the container moves", () => {
    const scroller = document.createElement("div");
    let scrollerTop = 20;
    let containerTop = 160.6;
    scroller.scrollTop = 10;
    const events: string[] = [];
    vi.spyOn(scroller, "getBoundingClientRect").mockImplementation(() => {
      events.push("measure");
      return {
        top: scrollerTop,
        bottom: scrollerTop,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: scrollerTop,
        toJSON: () => ({}),
      } as DOMRect;
    });

    let renderCount = 0;

    function Probe({
      scrollerEl,
      tick,
    }: {
      scrollerEl: HTMLElement | null;
      tick: number;
    }) {
      renderCount += 1;
      const containerRef = useRef<HTMLDivElement | null>(null);
      const [scrollMargin, scrollMarginSlot] =
        useTranscriptViewportScrollMarginState();
      useTranscriptViewportScrollMargin(
        scrollerEl,
        containerRef,
        scrollMarginSlot,
      );
      useLayoutEffect(() => {
        events.push(`layout:${scrollMargin}`);
      });
      useEffect(() => {
        events.push(`passive:${scrollMargin}`);
      });
      return (
        <div
          ref={(node) => {
            containerRef.current = node;
            if (node) stubTop(node, () => containerTop);
          }}
          data-testid="margin"
          data-tick={tick}
        >
          {scrollMargin}
        </div>
      );
    }

    const { rerender } = render(<Probe scrollerEl={scroller} tick={1} />);

    // Math.round(160.6 - 20 + 10) = 151. Measurement runs in useLayoutEffect
    // before the following useLayoutEffect and before any passive useEffect.
    expect(screen.getByTestId("margin")).toHaveTextContent("151");
    expect(events.indexOf("measure")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("measure")).toBeLessThan(events.indexOf("layout:0"));
    expect(events.indexOf("layout:0")).toBeLessThan(
      events.indexOf("layout:151"),
    );
    expect(events.indexOf("layout:151")).toBeLessThan(
      events.indexOf("passive:151"),
    );

    // A re-render with unchanged layout does not trigger an extra state-update render.
    const rendersBeforeSettled = renderCount;
    rerender(<Probe scrollerEl={scroller} tick={2} />);
    expect(renderCount).toBe(rendersBeforeSettled + 1);
    expect(screen.getByTestId("margin")).toHaveTextContent("151");

    // When the container moves on a later render (same scroller & ref identity),
    // the no-deps layout effect updates scrollMargin in layout phase before passive effects.
    containerTop = 95.2;
    scrollerTop = 20;
    scroller.scrollTop = 5;
    events.length = 0;
    rerender(<Probe scrollerEl={scroller} tick={3} />);

    // Math.round(95.2 - 20 + 5) = 80.
    expect(screen.getByTestId("margin")).toHaveTextContent("80");
    expect(events.indexOf("measure")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("measure")).toBeLessThan(
      events.indexOf("layout:151"),
    );
    expect(events.indexOf("layout:80")).toBeLessThan(
      events.indexOf("passive:80"),
    );
  });

  it("no-ops when scroller or container is null and re-measures on Activity reveal", () => {
    const scroller = document.createElement("div");
    let containerTop = 240;
    stubTop(scroller, () => 0);

    function Probe({ scrollerEl }: { scrollerEl: HTMLElement | null }) {
      const containerRef = useRef<HTMLDivElement | null>(null);
      const [scrollMargin, scrollMarginSlot] =
        useTranscriptViewportScrollMarginState();
      useTranscriptViewportScrollMargin(
        scrollerEl,
        containerRef,
        scrollMarginSlot,
      );
      return (
        <div
          ref={(node) => {
            containerRef.current = node;
            if (node) stubTop(node, () => containerTop);
          }}
          data-testid="margin"
        >
          {scrollMargin}
        </div>
      );
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe scrollerEl={null} />
      </Activity>,
    );
    expect(screen.getByTestId("margin")).toHaveTextContent("0");

    rerender(
      <Activity mode="visible">
        <Probe scrollerEl={scroller} />
      </Activity>,
    );
    expect(screen.getByTestId("margin")).toHaveTextContent("240");

    // Hide under Activity, change container offset, then reveal: re-measures.
    rerender(
      <Activity mode="hidden">
        <Probe scrollerEl={scroller} />
      </Activity>,
    );
    containerTop = 100;
    rerender(
      <Activity mode="visible">
        <Probe scrollerEl={scroller} />
      </Activity>,
    );
    expect(screen.getByTestId("margin")).toHaveTextContent("100");
  });

  it("measures scrollMargin after TanStack useVirtualizer updates container height when a row appends to a bottom-aligned list", () => {
    const VIEWPORT_HEIGHT = 400;
    const initialRows = [makeRow(0), makeRow(1)];
    const appendedRows = [...initialRows, makeRow(2)];
    const ROW_HEIGHT = estimateTranscriptRowHeight(initialRows[0], {
      listWidth: 600,
      viewportWidth: window.innerWidth,
    });
    observedVirtualizerScrollMargins.length = 0;

    const scroller = document.createElement("div");
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, get: () => VIEWPORT_HEIGHT },
      offsetHeight: { configurable: true, get: () => VIEWPORT_HEIGHT },
      clientWidth: { configurable: true, get: () => 600 },
      scrollHeight: {
        configurable: true,
        get: () => {
          const list = scroller.firstElementChild as HTMLElement | null;
          return Math.max(
            VIEWPORT_HEIGHT,
            Number.parseFloat(list?.style.height ?? "0") || 0,
          );
        },
      },
    });
    scroller.scrollTo = () => {};
    document.body.append(scroller);

    const originalGetRect = Element.prototype.getBoundingClientRect;
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    const originalResizeObserver = window.ResizeObserver;

    class NoopResizeObserver implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        if (this === scroller) return VIEWPORT_HEIGHT;
        if (this.hasAttribute("data-index")) return ROW_HEIGHT;
        return 0;
      },
    });
    Element.prototype.getBoundingClientRect = function () {
      const rect = originalGetRect.call(this).toJSON();
      if (this === scroller) {
        return {
          ...rect,
          top: 0,
          bottom: VIEWPORT_HEIGHT,
          height: VIEWPORT_HEIGHT,
          width: 600,
        };
      }
      if (this instanceof HTMLElement && this.hasAttribute("data-index")) {
        return { ...rect, top: 0, bottom: ROW_HEIGHT, height: ROW_HEIGHT };
      }
      // Bottom-aligned list container inside the 400px viewport: its top
      // tracks `VIEWPORT_HEIGHT - container.style.height`.
      if (this instanceof HTMLElement && this.parentElement === scroller) {
        const height = Number.parseFloat(this.style.height || "0") || 0;
        const top = Math.max(VIEWPORT_HEIGHT - height, 0);
        return { ...rect, top, bottom: top + height, height };
      }
      return rect;
    };
    window.ResizeObserver = NoopResizeObserver;

    const handle = createRef<TranscriptViewportHandle>();

    try {
      const { rerender, unmount } = render(
        <TranscriptViewport
          ref={handle}
          scroller={scroller}
          rows={initialRows}
          renderRow={(row) =>
            row.kind === "message" ? <div>{row.message.content}</div> : null
          }
          holdOffBottom={false}
        />,
        { container: scroller },
      );

      // 2 rows in a 400px bottom-aligned viewport -> margin = 400 - 2 * ROW_HEIGHT.
      expect(observedVirtualizerScrollMargins.at(-1)).toBe(
        VIEWPORT_HEIGHT - 2 * ROW_HEIGHT,
      );

      // Appending a 3rd row whose measured height matches its estimate grows
      // container.style.height inside useVirtualizer's layout effect (not
      // measureElement). Scroll margin must commit `400 - 3 * ROW_HEIGHT` on
      // the same append pass, without waiting for an unrelated later render.
      rerender(
        <TranscriptViewport
          ref={handle}
          scroller={scroller}
          rows={appendedRows}
          renderRow={(row) =>
            row.kind === "message" ? <div>{row.message.content}</div> : null
          }
          holdOffBottom={false}
        />,
      );

      expect(observedVirtualizerScrollMargins.at(-1)).toBe(
        VIEWPORT_HEIGHT - 3 * ROW_HEIGHT,
      );
      unmount();
    } finally {
      Element.prototype.getBoundingClientRect = originalGetRect;
      if (originalOffsetHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          "offsetHeight",
          originalOffsetHeight,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
      }
      window.ResizeObserver = originalResizeObserver;
      scroller.remove();
    }
  });
});
