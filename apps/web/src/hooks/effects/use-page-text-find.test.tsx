import { act, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePageTextFind } from "./use-page-text-find";

class FakeHighlight {
  ranges: Range[];

  constructor(...ranges: Range[]) {
    this.ranges = [...ranges];
  }

  add(range: Range) {
    this.ranges.push(range);
    return this;
  }
}

describe("usePageTextFind", () => {
  let root: HTMLDivElement;
  let contentRef: RefObject<HTMLElement | null>;
  let originalCss: typeof globalThis.CSS;
  let originalHighlight: typeof globalThis.Highlight;

  beforeEach(() => {
    originalCss = globalThis.CSS;
    originalHighlight = globalThis.Highlight;
    root = document.createElement("div");
    document.body.appendChild(root);
    contentRef = { current: root };
  });

  afterEach(() => {
    root.remove();
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      writable: true,
      value: originalCss,
    });
    Object.defineProperty(globalThis, "Highlight", {
      configurable: true,
      writable: true,
      value: originalHighlight,
    });
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  function installCustomHighlights() {
    const highlights = new Map<string, FakeHighlight>();
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      writable: true,
      value: { ...(originalCss ?? {}), highlights },
    });
    Object.defineProperty(globalThis, "Highlight", {
      configurable: true,
      writable: true,
      value: FakeHighlight,
    });
    return highlights;
  }

  function disableCustomHighlights() {
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      writable: true,
      value: {},
    });
    Object.defineProperty(globalThis, "Highlight", {
      configurable: true,
      writable: true,
      value: undefined,
    });
  }

  it("finds visible text matches, wraps when stepping, resets position on query change, and registers/clears CSS highlights", () => {
    const highlights = installCustomHighlights();
    root.innerHTML =
      '<p id="p1">Alpha beta</p><p id="p2">ALPHA gamma</p><p id="p3" hidden>Alpha hidden</p>';
    const first = root.querySelector("#p1")!;
    const second = root.querySelector("#p2")!;
    const firstScroll = vi.fn();
    const secondScroll = vi.fn();
    first.scrollIntoView = firstScroll;
    second.scrollIntoView = secondScroll;

    const { result, rerender, unmount } = renderHook(
      ({ query }: { query: string }) => usePageTextFind(contentRef, query),
      { initialProps: { query: "   " } },
    );

    expect(result.current.count).toBe(0);
    expect(result.current.index).toBe(0);
    expect(highlights.size).toBe(0);

    // Stepping with zero matches is a no-op.
    act(() => {
      result.current.step(1);
    });
    expect(result.current.index).toBe(0);

    // Querying matches visible occurrences and highlights all + current.
    rerender({ query: "alpha" });
    expect(result.current.count).toBe(2);
    expect(result.current.index).toBe(0);
    expect(firstScroll).toHaveBeenCalledTimes(1);
    expect(firstScroll).toHaveBeenLastCalledWith({
      block: "center",
      inline: "nearest",
    });
    expect(highlights.get("sokosumi-page-matches")?.ranges).toHaveLength(2);
    expect(highlights.get("sokosumi-page-current")?.ranges).toHaveLength(1);
    expect(highlights.get("sokosumi-page-current")?.ranges[0]?.toString()).toBe(
      "Alpha",
    );

    // Step forward to second match and scroll it into view.
    act(() => {
      result.current.step(1);
    });
    expect(result.current.index).toBe(1);
    expect(secondScroll).toHaveBeenCalledTimes(1);
    expect(highlights.get("sokosumi-page-current")?.ranges[0]?.toString()).toBe(
      "ALPHA",
    );

    // Wrap forward back to 0, then wrap backward to 1.
    act(() => {
      result.current.step(1);
    });
    expect(result.current.index).toBe(0);
    act(() => {
      result.current.step(-1);
    });
    expect(result.current.index).toBe(1);

    // Changing query resets position to 0.
    rerender({ query: "beta" });
    expect(result.current.count).toBe(1);
    expect(result.current.index).toBe(0);
    expect(highlights.get("sokosumi-page-current")?.ranges[0]?.toString()).toBe(
      "beta",
    );

    // Clearing query removes highlights and resets count.
    rerender({ query: "" });
    expect(result.current.count).toBe(0);
    expect(result.current.index).toBe(0);
    expect(highlights.has("sokosumi-page-matches")).toBe(false);
    expect(highlights.has("sokosumi-page-current")).toBe(false);

    // Re-activating then unmounting cleans up highlights.
    rerender({ query: "gamma" });
    expect(highlights.has("sokosumi-page-matches")).toBe(true);
    unmount();
    expect(highlights.has("sokosumi-page-matches")).toBe(false);
    expect(highlights.has("sokosumi-page-current")).toBe(false);
  });

  it("falls back to window Selection when CSS.highlights is unavailable and preserves unrelated user selections on cleanup", () => {
    disableCustomHighlights();
    root.innerHTML =
      '<p id="hit">Find needle here</p><p id="other">Other text</p>';
    const hit = root.querySelector("#hit")!;
    hit.scrollIntoView = vi.fn();

    const { result, unmount } = renderHook(() =>
      usePageTextFind(contentRef, "needle"),
    );

    expect(result.current.count).toBe(1);
    const selection = window.getSelection();
    expect(selection?.rangeCount).toBe(1);
    expect(selection?.getRangeAt(0).toString()).toBe("needle");

    // Unmounting clears the selection when it still holds the active match range.
    unmount();
    expect(selection?.rangeCount).toBe(0);

    // If the user selects something else before cleanup, unmount leaves it alone.
    const secondMount = renderHook(() => usePageTextFind(contentRef, "needle"));
    expect(selection?.getRangeAt(0).toString()).toBe("needle");

    const otherNode = root.querySelector("#other")!.firstChild!;
    const userRange = document.createRange();
    userRange.setStart(otherNode, 0);
    userRange.setEnd(otherNode, 5);
    selection?.removeAllRanges();
    selection?.addRange(userRange);

    secondMount.unmount();
    expect(selection?.rangeCount).toBe(1);
    expect(selection?.getRangeAt(0).toString()).toBe("Other");
  });

  it("rescans on DOM mutations via requestAnimationFrame, clamps index when matches shrink, skips redundant scroll when matches are unchanged, and cancels pending frames on unmount", async () => {
    installCustomHighlights();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    });
    const cancelRaf = vi
      .spyOn(globalThis, "cancelAnimationFrame")
      .mockImplementation((id) => {
        frames.delete(id);
      });

    root.innerHTML =
      '<p id="a">token one</p><p id="b">token two</p><span id="clock">12:00</span>';
    const first = root.querySelector("#a")!;
    const second = root.querySelector("#b")!;
    const firstScroll = vi.fn();
    const secondScroll = vi.fn();
    first.scrollIntoView = firstScroll;
    second.scrollIntoView = secondScroll;

    const { result, unmount } = renderHook(() =>
      usePageTextFind(contentRef, "token"),
    );

    expect(result.current.count).toBe(2);
    expect(firstScroll).toHaveBeenCalledTimes(1);

    // Move to the second match.
    act(() => {
      result.current.step(1);
    });
    expect(result.current.index).toBe(1);
    expect(secondScroll).toHaveBeenCalledTimes(1);

    // Unrelated DOM mutation (e.g. a clock tick) schedules one coalesced frame
    // and must NOT re-scroll when the matched ranges are identical.
    root.querySelector("#clock")!.textContent = "12:01";
    await act(async () => {
      await Promise.resolve();
    });
    expect(frames.size).toBe(1);
    act(() => {
      for (const [id, cb] of [...frames.entries()]) {
        frames.delete(id);
        cb(16);
      }
    });
    expect(result.current.count).toBe(2);
    expect(result.current.index).toBe(1);
    expect(secondScroll).toHaveBeenCalledTimes(1);

    // Hiding the second match shrinks count to 1 and clamps index to 0.
    second.setAttribute("hidden", "");
    await act(async () => {
      await Promise.resolve();
    });
    expect(frames.size).toBe(1);
    act(() => {
      for (const [id, cb] of [...frames.entries()]) {
        frames.delete(id);
        cb(32);
      }
    });
    expect(result.current.count).toBe(1);
    expect(result.current.index).toBe(0);

    // Queue another mutation then unmount before the frame fires: frame is cancelled.
    const added = document.createElement("p");
    added.textContent = "token three";
    root.appendChild(added);
    await act(async () => {
      await Promise.resolve();
    });
    expect(frames.size).toBe(1);
    const pendingId = [...frames.keys()][0];

    unmount();
    expect(cancelRaf).toHaveBeenCalledWith(pendingId);
    expect(frames.size).toBe(0);
  });

  it("handles a null content ref without throwing", () => {
    const emptyRef: RefObject<HTMLElement | null> = { current: null };
    const { result } = renderHook(() => usePageTextFind(emptyRef, "hello"));
    expect(result.current.count).toBe(0);
    expect(result.current.index).toBe(0);
  });
});
