import { act, render, renderHook } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ComposerSuggestion } from "@/components/chat/composer-suggestions";
import { ROOM_COMPOSER_MENTION_ANCHOR_ATTR } from "@/components/chat/room-message-composer";
import { useComposerSuggestionPopupPosition } from "./use-composer-suggestion-popup-position";

function createRect(rect: {
  top: number;
  left: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    ...rect,
    x: rect.left,
    y: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => rect,
  };
}

function createFakeVisualViewport(initial: {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
}) {
  const target = new EventTarget();
  let state = { ...initial };

  Object.defineProperties(target, {
    width: { get: () => state.width, configurable: true },
    height: { get: () => state.height, configurable: true },
    offsetTop: { get: () => state.offsetTop, configurable: true },
    offsetLeft: { get: () => state.offsetLeft, configurable: true },
    scale: { get: () => 1, configurable: true },
  });

  return {
    viewport: target as unknown as VisualViewport,
    update(next: Partial<typeof initial>) {
      state = { ...state, ...next };
    },
  };
}

describe("useComposerSuggestionPopupPosition", () => {
  const originalVisualViewport = Object.getOwnPropertyDescriptor(
    window,
    "visualViewport",
  );
  const originalInnerWidth = Object.getOwnPropertyDescriptor(
    window,
    "innerWidth",
  );
  const originalInnerHeight = Object.getOwnPropertyDescriptor(
    window,
    "innerHeight",
  );

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      value: 1280,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalVisualViewport) {
      Object.defineProperty(window, "visualViewport", originalVisualViewport);
    } else {
      Reflect.deleteProperty(window, "visualViewport");
    }
    if (originalInnerWidth) {
      Object.defineProperty(window, "innerWidth", originalInnerWidth);
    }
    if (originalInnerHeight) {
      Object.defineProperty(window, "innerHeight", originalInnerHeight);
    }
  });

  it("returns null while closed and measures anchor geometry immediately on open", () => {
    const fakeVv = createFakeVisualViewport({
      width: 1280,
      height: 800,
      offsetTop: 0,
      offsetLeft: 0,
    });
    Object.defineProperty(window, "visualViewport", {
      value: fakeVv.viewport,
      configurable: true,
    });

    const anchor = document.createElement("div");
    anchor.setAttribute(ROOM_COMPOSER_MENTION_ANCHOR_ATTR, "");
    const editor = document.createElement("div");
    anchor.appendChild(editor);
    document.body.appendChild(anchor);

    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(
      createRect({ top: 674, left: 318, width: 856, height: 102 }),
    );

    try {
      const { result, rerender } = renderHook(
        ({ kind }: { kind: ComposerSuggestion["kind"] | null }) =>
          useComposerSuggestionPopupPosition(editor, kind),
        { initialProps: { kind: null as ComposerSuggestion["kind"] | null } },
      );

      expect(result.current).toBeNull();

      rerender({ kind: "mention" });

      expect(result.current).toEqual({
        top: 670,
        left: 318,
        side: "top",
        maxHeight: 240,
        width: 856,
      });
    } finally {
      anchor.remove();
    }
  });

  it("updates on window resize and visualViewport resize/scroll, and unsubscribes on close", () => {
    const fakeVv = createFakeVisualViewport({
      width: 390,
      height: 844,
      offsetTop: 0,
      offsetLeft: 0,
    });
    Object.defineProperty(window, "visualViewport", {
      value: fakeVv.viewport,
      configurable: true,
    });
    Object.defineProperty(window, "innerWidth", {
      value: 390,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 844,
      configurable: true,
    });

    const anchor = document.createElement("div");
    anchor.setAttribute(ROOM_COMPOSER_MENTION_ANCHOR_ATTR, "");
    const editor = document.createElement("div");
    anchor.appendChild(editor);
    document.body.appendChild(anchor);

    let rect = createRect({ top: 722, left: 12, width: 354, height: 110 });
    const getRectSpy = vi
      .spyOn(anchor, "getBoundingClientRect")
      .mockImplementation(() => rect);

    try {
      const { result, rerender } = renderHook(
        ({ kind }: { kind: ComposerSuggestion["kind"] | null }) =>
          useComposerSuggestionPopupPosition(editor, kind),
        {
          initialProps: {
            kind: "mention" as ComposerSuggestion["kind"] | null,
          },
        },
      );

      expect(result.current).toEqual({
        top: 718,
        left: 12,
        side: "top",
        maxHeight: 240,
        width: 354,
      });

      // visualViewport scroll clamps maxHeight
      act(() => {
        fakeVv.update({ height: 360, offsetTop: 560 });
        fakeVv.viewport.dispatchEvent(new Event("scroll"));
      });
      expect(result.current).toEqual({
        top: 718,
        left: 12,
        side: "top",
        maxHeight: 150,
        width: 354,
      });

      // window resize shifts layout
      act(() => {
        fakeVv.update({ width: 390, height: 480, offsetTop: 0 });
        Object.defineProperty(window, "innerHeight", {
          value: 480,
          configurable: true,
        });
        rect = createRect({ top: 370, left: 12, width: 354, height: 110 });
        window.dispatchEvent(new Event("resize"));
      });
      expect(result.current).toEqual({
        top: 366,
        left: 12,
        side: "top",
        maxHeight: 240,
        width: 354,
      });

      // Close unsubscribes: later resize events do not measure
      rerender({ kind: null });
      expect(result.current).toBeNull();
      getRectSpy.mockClear();

      act(() => {
        window.dispatchEvent(new Event("resize"));
        fakeVv.viewport.dispatchEvent(new Event("resize"));
        fakeVv.viewport.dispatchEvent(new Event("scroll"));
      });
      expect(getRectSpy).not.toHaveBeenCalled();
    } finally {
      anchor.remove();
    }
  });

  it("re-measures after the 2-frame settle and cancels pending frames on close", () => {
    const fakeVv = createFakeVisualViewport({
      width: 390,
      height: 844,
      offsetTop: 0,
      offsetLeft: 0,
    });
    Object.defineProperty(window, "visualViewport", {
      value: fakeVv.viewport,
      configurable: true,
    });

    const rafCallbacks = new Map<number, FrameRequestCallback>();
    let nextRafId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      const id = nextRafId;
      nextRafId += 1;
      rafCallbacks.set(id, cb);
      return id;
    });
    const cancelSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => {
        rafCallbacks.delete(id);
      });

    const anchor = document.createElement("div");
    anchor.setAttribute(ROOM_COMPOSER_MENTION_ANCHOR_ATTR, "");
    const editor = document.createElement("div");
    anchor.appendChild(editor);
    document.body.appendChild(anchor);

    let rect = createRect({ top: 722, left: 12, width: 354, height: 110 });
    vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(() => rect);

    try {
      const { result, rerender } = renderHook(
        ({ kind }: { kind: ComposerSuggestion["kind"] | null }) =>
          useComposerSuggestionPopupPosition(editor, kind),
        {
          initialProps: {
            kind: "mention" as ComposerSuggestion["kind"] | null,
          },
        },
      );

      expect(result.current?.top).toBe(718);

      // Composer shifts after mount without firing resize/scroll
      rect = createRect({ top: 674, left: 12, width: 354, height: 110 });

      // Frame 1 queues nested frame 2; position has not changed yet
      const [firstId, firstCb] = Array.from(rafCallbacks.entries())[0]!;
      rafCallbacks.delete(firstId);
      act(() => {
        firstCb(16);
      });
      expect(result.current?.top).toBe(718);

      // Frame 2 triggers store update and picks up the settled anchor
      const [secondId, secondCb] = Array.from(rafCallbacks.entries())[0]!;
      rafCallbacks.delete(secondId);
      act(() => {
        secondCb(32);
      });
      expect(result.current?.top).toBe(670);

      // Re-open with a different kind and close before rAF settles: cancels frame
      rerender({ kind: "emoji" });
      expect(rafCallbacks.size).toBe(1);
      rerender({ kind: null });
      expect(cancelSpy).toHaveBeenCalled();
      expect(rafCallbacks.size).toBe(0);
    } finally {
      anchor.remove();
    }
  });

  it("re-renders when window.innerHeight changes even if TriggerPosition fields stay identical", () => {
    const fakeVv = createFakeVisualViewport({
      width: 390,
      height: 844,
      offsetTop: 0,
      offsetLeft: 0,
    });
    Object.defineProperty(window, "visualViewport", {
      value: fakeVv.viewport,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    });

    const anchor = document.createElement("div");
    anchor.setAttribute(ROOM_COMPOSER_MENTION_ANCHOR_ATTR, "");
    const editor = document.createElement("div");
    anchor.appendChild(editor);
    document.body.appendChild(anchor);

    // Anchor near top: top stays 100 and maxHeight stays 88 even when innerHeight drops.
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(
      createRect({ top: 100, left: 12, width: 354, height: 110 }),
    );

    const observedBottoms: number[] = [];

    function Probe() {
      const pos = useComposerSuggestionPopupPosition(editor, "mention");
      if (pos) {
        observedBottoms.push(window.innerHeight - pos.top);
      }
      return null;
    }

    try {
      render(<Probe />);
      expect(observedBottoms.at(-1)).toBe(800 - 96);

      act(() => {
        Object.defineProperty(window, "innerHeight", {
          value: 600,
          configurable: true,
        });
        window.dispatchEvent(new Event("resize"));
      });
      expect(observedBottoms.at(-1)).toBe(600 - 96);
    } finally {
      anchor.remove();
    }
  });

  it("stays stable under StrictMode for caret-anchored editors without a composer anchor", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.textContent = "@el";
    document.body.appendChild(editor);

    vi.spyOn(editor, "getBoundingClientRect").mockReturnValue(
      createRect({ top: 579, left: 365, width: 792, height: 44 }),
    );

    let lastPosition: ReturnType<typeof useComposerSuggestionPopupPosition> =
      null;

    function Probe() {
      const [kind] = useState<ComposerSuggestion["kind"]>("mention");
      lastPosition = useComposerSuggestionPopupPosition(editor, kind);
      return null;
    }

    try {
      render(
        <StrictMode>
          <Probe />
        </StrictMode>,
      );

      expect(lastPosition).toEqual({
        top: 575,
        left: 365,
        side: "top",
        maxHeight: 240,
      });
    } finally {
      editor.remove();
    }
  });
});
