import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ComposerSuggestion } from "@/components/chat/composer-suggestions";
import { ROOM_COMPOSER_MENTION_ANCHOR_ATTR } from "@/components/chat/room-message-composer";
import { useComposerSuggestionPopupPosition } from "./use-composer-suggestion-popup-position";

const mention = (query = ""): ComposerSuggestion => ({
  kind: "mention",
  query,
  triggerStart: 0,
});

const rect = (top: number, left: number, width: number, height: number) =>
  DOMRect.fromRect({ x: left, y: top, width, height });

function stubViewport(width: number, height: number, offsetTop = 0) {
  const vv = Object.assign(new EventTarget(), {
    width,
    height,
    offsetTop,
    offsetLeft: 0,
  });
  const set = (
    next: Partial<Record<"width" | "height" | "offsetTop", number>>,
  ) => {
    Object.assign(vv, next);
    vi.stubGlobal("innerWidth", vv.width);
    vi.stubGlobal("innerHeight", vv.height);
  };
  set({});
  vi.stubGlobal("visualViewport", vv);
  return { vv, set };
}

function mountAnchoredEditor(initial: DOMRect) {
  const anchor = document.body.appendChild(document.createElement("div"));
  anchor.setAttribute(ROOM_COMPOSER_MENTION_ANCHOR_ATTR, "");
  const editor = anchor.appendChild(document.createElement("div"));
  let current = initial;
  const spy = vi
    .spyOn(anchor, "getBoundingClientRect")
    .mockImplementation(() => current);
  return { editor, spy, setRect: (next: DOMRect) => void (current = next) };
}

describe("useComposerSuggestionPopupPosition", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("measures on open for anchored and caret-only editors (a)", () => {
    stubViewport(1280, 800);
    const anchored = mountAnchoredEditor(rect(674, 318, 856, 102));
    const bare = document.body.appendChild(document.createElement("div"));
    vi.spyOn(bare, "getBoundingClientRect").mockReturnValue(
      rect(579, 365, 792, 44),
    );

    const { result, rerender } = renderHook(
      (p: { ed: HTMLElement | null; s: ComposerSuggestion | null }) =>
        useComposerSuggestionPopupPosition(p.ed, p.s),
      {
        initialProps: {
          ed: anchored.editor as HTMLElement | null,
          s: null as ComposerSuggestion | null,
        },
      },
    );
    expect(result.current).toBeNull();

    rerender({ ed: anchored.editor, s: mention() });
    expect(result.current).toEqual({
      top: 670,
      left: 318,
      side: "top",
      maxHeight: 240,
      width: 856,
    });

    rerender({ ed: bare, s: mention() });
    expect(result.current).toEqual({
      top: 575,
      left: 365,
      side: "top",
      maxHeight: 240,
    });
  });

  it("re-measures on typing updates and skips unrelated rerenders (b)", () => {
    stubViewport(1280, 800);
    const anchored = mountAnchoredEditor(rect(674, 318, 856, 102));
    const initial = mention();
    const { result, rerender } = renderHook(
      (s: ComposerSuggestion | null) =>
        useComposerSuggestionPopupPosition(anchored.editor, s),
      { initialProps: initial as ComposerSuggestion | null },
    );
    expect(result.current?.top).toBe(670);

    anchored.spy.mockClear();
    rerender(initial);
    expect(anchored.spy).not.toHaveBeenCalled();

    anchored.setRect(rect(614, 318, 856, 162));
    rerender(mention("e"));
    expect(result.current?.top).toBe(610);
  });

  it("tracks window resize and visualViewport scroll, unsubscribing on close (c)", () => {
    const vp = stubViewport(1280, 800);
    const anchored = mountAnchoredEditor(rect(674, 318, 856, 102));
    const { result, rerender } = renderHook(
      (s: ComposerSuggestion | null) =>
        useComposerSuggestionPopupPosition(anchored.editor, s),
      { initialProps: mention() as ComposerSuggestion | null },
    );

    act(() => {
      vp.set({ offsetTop: 520 });
      vp.vv.dispatchEvent(new Event("scroll"));
    });
    expect(result.current?.maxHeight).toBe(142);

    act(() => {
      vp.set({ width: 1024, height: 640, offsetTop: 0 });
      anchored.setRect(rect(514, 244, 748, 102));
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({
      top: 510,
      left: 244,
      side: "top",
      maxHeight: 240,
      width: 748,
    });

    rerender(null);
    expect(result.current).toBeNull();
    anchored.spy.mockClear();
    act(() => {
      window.dispatchEvent(new Event("resize"));
      vp.vv.dispatchEvent(new Event("resize"));
      vp.vv.dispatchEvent(new Event("scroll"));
    });
    expect(anchored.spy).not.toHaveBeenCalled();
  });

  it("handles mobile keyboard visualViewport resize and 2-frame settle (d)", () => {
    const vp = stubViewport(390, 844);
    const anchored = mountAnchoredEditor(rect(722, 12, 354, 110));
    const rafs = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      const id = nextId++;
      rafs.set(id, cb);
      return id;
    });
    const cancelSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => {
        rafs.delete(id);
      });

    const { result, rerender } = renderHook(
      (s: ComposerSuggestion | null) =>
        useComposerSuggestionPopupPosition(anchored.editor, s),
      { initialProps: mention() as ComposerSuggestion | null },
    );
    expect(result.current?.top).toBe(718);

    anchored.setRect(rect(674, 12, 354, 110));
    const runNextRaf = () => {
      const [id, cb] = Array.from(rafs.entries())[0]!;
      rafs.delete(id);
      act(() => cb(16));
    };
    runNextRaf();
    expect(result.current?.top).toBe(718);
    runNextRaf();
    expect(result.current?.top).toBe(670);

    act(() => {
      vp.set({ height: 360, offsetTop: 560 });
      anchored.setRect(rect(734, 12, 354, 110));
      vp.vv.dispatchEvent(new Event("resize"));
    });
    expect(result.current?.maxHeight).toBe(162);

    rerender({ kind: "emoji", query: "sm", triggerStart: 0, matches: [] });
    expect(rafs.size).toBe(1);
    rerender(null);
    expect(cancelSpy).toHaveBeenCalled();
    expect(rafs.size).toBe(0);
  });
});
