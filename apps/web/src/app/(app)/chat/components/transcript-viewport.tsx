"use client";

import {
  type Range,
  useVirtualizer,
  type Virtualizer,
} from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { CHAT_MESSAGE_LIST_ROOM } from "@/app/chat/chat-message-list";
import { ClampedOverflowProvider } from "@/app/chat/hooks/use-clamped-overflow";
import { highlightListMessage } from "@/app/chat/utils/room-message-highlight";
import type { RoomTranscriptRenderRow } from "@/app/chat/utils/room-transcript-ranges";
import {
  estimateTranscriptRowHeight,
  findTranscriptRowIndex,
  STICK_TO_BOTTOM_NEAR_PX,
  transcriptRowKey,
} from "@/app/chat/utils/transcript-viewport-model";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";

/**
 * Rows mounted beyond the viewport. Deep above, shallow below: a row is
 * measured when it mounts, and a row that measures taller than its estimate
 * shifts everything under it. Mounted while the reader is still reading,
 * that shift is put back before paint; mounted while they scroll toward it,
 * it shows. Below the viewport only the live edge needs a buffer.
 * 30 / 8 is the old 2400 / 600 px at 80px.
 */
const OVERSCAN_ROWS = { above: 30, below: 8 };

/**
 * A rich-text editor. The one below the transcript is blurred when the
 * reader drags it; the ones inside it (in-row message edit) are left alone.
 * Matched by attribute rather than `isContentEditable` so the rule is the
 * markup React writes.
 */
const EDITOR_SELECTOR = '[contenteditable="true"]';

/** A scroll is over this long after its last event, where `scrollend` is missing. */
const SCROLL_END_FALLBACK_MS = 150;

/**
 * A lifted finger is followed by momentum, and the first scroll event of it
 * comes a little later. Until then the touch still counts.
 */
const TOUCH_END_GRACE_MS = 150;

/**
 * How many frames a landing waits for its row to mount after the scroll.
 * The virtualizer re-issues a scroll while rows above the target are still
 * being measured, so the wait covers that.
 */
const LANDING_FRAMES = 90;

export interface TranscriptViewportHandle {
  /** Live edge, whatever the reader was doing. Drops any hold. */
  scrollToBottom: () => void;
  /** Own send: always reveal the new bubble, even after scrolling up. */
  pinToBottomAfterOwnSend: () => void;
  /** A jump is moving the view; stop following new messages until released. */
  suppressStickToBottom: () => void;
  releaseStickToBottomSuppress: () => void;
  /**
   * Put a message on screen and mark it. True when the transcript holds it,
   * in which case the row is scrolled to the center and marked once it has
   * mounted. False when the message is not loaded, which is the caller's cue
   * to load a window around it.
   */
  landOnMessage: (messageId: string) => boolean;
  /** Smooth scroll to a message with no mark. False when it is not loaded. */
  scrollToMessage: (messageId: string) => boolean;
}

export interface TranscriptPosition {
  anchorId: string | null;
  anchorCreatedAt: number;
  offset: number;
  atLiveEdge: boolean;
  visibleMessageIds: string[];
}

interface TranscriptViewportProps {
  initialPosition?: TranscriptPosition;
  onPositionChange?: (position: TranscriptPosition) => void;
  /**
   * The native overflow scroller the list lives in. Handed in as an element
   * rather than a ref: on a same-commit mount the shell's ref is attached
   * after this component's effects have run, so a ref read here would still
   * be empty.
   */
  scroller: HTMLElement | null;
  rows: readonly RoomTranscriptRenderRow[];
  renderRow: (row: RoomTranscriptRenderRow) => ReactNode;
  /**
   * Which list a landing marks. Room and thread share message ids, so a
   * document-wide lookup would take the wrong copy.
   */
  list?: string;
  /** Search jump: do not follow new messages while landing on an older hit. */
  holdOffBottom: boolean;
  ref: Ref<TranscriptViewportHandle>;
}

type TranscriptVirtualizer = Virtualizer<HTMLElement, HTMLDivElement>;

/** What the hold below needs from the virtualizer, before the rows change. */
type RowHoldSource = Pick<
  TranscriptVirtualizer,
  "scrollOffset" | "getVirtualItemForOffset" | "measurementsCache"
>;

/** A row to put back where it was once the rows around it have changed. */
export interface RowHold {
  key: string;
  /** Scroll offset minus the row's start: where the top edge sat from the row. */
  offset: number;
}

function maxScrollOf(element: HTMLElement): number {
  return element.scrollHeight - element.clientHeight;
}

/**
 * The scroller is bottom-anchored: `scrollTop` is 0 at the newest message
 * and negative above it. The virtualizer counts from the top.
 */
function topOffsetOf(element: HTMLElement): number {
  return maxScrollOf(element) + element.scrollTop;
}

/**
 * Whether the view sits on the live edge. `scrollTop` is fractional on a
 * zoomed or high-density display, so exactly 0 is not the test.
 */
function isAtLiveEdge(element: HTMLElement): boolean {
  return -element.scrollTop < 1;
}

/**
 * Tells the virtualizer its top-based offset. That offset moves without a
 * scroll event whenever the list grows, which is why `onChange` reads it
 * again, and whenever the scroller is resized, which is reported here.
 */
export function observeBottomAnchoredOffset(
  instance: TranscriptVirtualizer,
  report: (offset: number, isScrolling: boolean) => void,
): (() => void) | undefined {
  const element = instance.scrollElement;
  if (!element) {
    return undefined;
  }
  const read = () => topOffsetOf(element);
  const hasScrollEnd = "onscrollend" in window;
  let fallback: number | undefined;
  const onScroll = () => {
    if (!hasScrollEnd) {
      window.clearTimeout(fallback);
      fallback = window.setTimeout(onScrollEnd, SCROLL_END_FALLBACK_MS);
    }
    report(read(), true);
  };
  const onScrollEnd = () => {
    report(read(), false);
  };
  // A composer that grows or a keyboard that opens: the distance from the
  // end holds, so the offset from the top does not.
  const resize = new ResizeObserver(() => {
    report(read(), instance.isScrolling);
  });
  resize.observe(element);
  element.addEventListener("scroll", onScroll, { passive: true });
  element.addEventListener("scrollend", onScrollEnd, { passive: true });
  onScrollEnd();
  return () => {
    resize.disconnect();
    element.removeEventListener("scroll", onScroll);
    element.removeEventListener("scrollend", onScrollEnd);
    window.clearTimeout(fallback);
  };
}

/**
 * The virtualizer's top-based offset, written as the distance from the end.
 * Its `adjustments` are dropped: they put the view back after a row above it
 * changed height, and a bottom-anchored scroller never moved it.
 */
export function scrollBottomAnchored(
  offset: number,
  { behavior }: { behavior?: ScrollBehavior },
  instance: TranscriptVirtualizer,
): void {
  const element = instance.scrollElement;
  if (!element) {
    return;
  }
  // A write that moves nothing still ends a touch scroll's momentum on iOS.
  const top = offset - maxScrollOf(element);
  if (Math.abs(top - element.scrollTop) >= 1) {
    element.scrollTo({ top, behavior });
  }
}

function transcriptRangeExtractor(range: Range): number[] {
  const start = Math.max(range.startIndex - OVERSCAN_ROWS.above, 0);
  const end = Math.min(range.endIndex + OVERSCAN_ROWS.below, range.count - 1);
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

/**
 * The row a reader away from the live edge keeps in place when the rows
 * change: the first one from the top edge down that is still there. Mostly
 * that is the row under the edge. It is not when that row is the one that
 * changed: a boundary row is replaced by the page it loaded, or removed once
 * history is exhausted. Then the messages below it are what the reader was
 * reading, and the first of them stays put.
 */
export function rowHoldAfterRowsChange(
  virtualizer: RowHoldSource,
  previousRows: readonly RoomTranscriptRenderRow[],
  nextRows: readonly RoomTranscriptRenderRow[],
): RowHold | null {
  const scrollOffset = virtualizer.scrollOffset ?? 0;
  // Refreshes the measurements cache read below.
  const edgeItem = virtualizer.getVirtualItemForOffset(scrollOffset);
  if (!edgeItem) {
    return null;
  }
  const nextKeys = new Set(nextRows.map(transcriptRowKey));
  const survivorIndex = previousRows.findIndex(
    (row, index) =>
      index >= edgeItem.index && nextKeys.has(transcriptRowKey(row)),
  );
  const survivor = virtualizer.measurementsCache[survivorIndex];
  if (!survivor) {
    return null;
  }
  // Negative when the survivor sat below the edge: it stays where it was,
  // and the rows that replaced the ones above it fill the gap.
  return {
    key: String(survivor.key),
    offset: scrollOffset - survivor.start,
  };
}

function retainedPositionIndex(
  rows: readonly RoomTranscriptRenderRow[],
  saved: TranscriptPosition,
): number {
  const exact = saved.anchorId
    ? findTranscriptRowIndex(rows, saved.anchorId)
    : -1;
  if (exact >= 0 || saved.atLiveEdge) return exact;
  let index = -1;
  let nearest = Infinity;
  rows.forEach((row, candidate) => {
    if (row.kind !== "message") return;
    const distance = Math.abs(
      new Date(row.message.createdAt).getTime() - saved.anchorCreatedAt,
    );
    if (distance < nearest) {
      nearest = distance;
      index = candidate;
    }
  });
  return index;
}

/**
 * A transcript, mounting only the rows near the viewport.
 *
 * The virtualizer owns which rows exist, how tall they are, and following
 * new rows at the live edge. The scroller is bottom-anchored, so whatever
 * changes above the view leaves it where it is. This component owns what
 * changes at or below it, the hold a jump takes on the follow, and landing
 * on a message the reader was sent to. Remount it (key by room or thread
 * parent) to open on the newest message.
 */
export function TranscriptViewport({
  scroller,
  rows,
  renderRow,
  list = CHAT_MESSAGE_LIST_ROOM,
  holdOffBottom,
  initialPosition,
  onPositionChange,
  ref,
}: TranscriptViewportProps) {
  // A prop of the virtualizer rather than a ref: it decides per render
  // whether an append pulls the view down. A jump that merges a window while
  // the reader sits at the live edge would otherwise be undone by that pull.
  const [held, setHeld] = useState(
    Boolean(initialPosition && !initialPosition.atLiveEdge),
  );
  const restoreRef = useRef(initialPosition);
  const restoringRef = useRef(false);
  const positionCallbackRef = useRef(onPositionChange);
  positionCallbackRef.current = onPositionChange;
  const lastPositionRef = useRef("");
  const hold = held || holdOffBottom;
  const landingRef = useRef(0);
  // Unmount ends a landing still polling for its row.
  useMountEffect(() => () => {
    landingRef.current += 1;
  });

  // Where the list starts inside the scroller: the shell pads above it, and
  // pushes a short list to the bottom. The virtualizer needs that offset so
  // its end is the scroller's end.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // How far above the live edge the reader sat at the last scroll or
  // virtualizer change. Read then, not when asked: chrome that resizes the
  // scroller moves the edge away before anyone asks.
  const distanceFromEndRef = useRef(0);
  // Whether that is near the edge, as state for the jump-to-latest control
  // that shows whenever the reader is away from it.
  const [atEnd, setAtEnd] = useState(true);

  // The previous render's instance, for the look at the old rows below. The
  // instance itself never changes; the ref exists to read it before the hook
  // replaces its measurements with this render's rows.
  const virtualizerRef = useRef<TranscriptVirtualizer | null>(null);
  const rowsRef = useRef(rows);
  // What the rows change below needs from before it: the scroller keeps its
  // distance from the end through the change, so the top-based offset moves
  // by however much the list grew.
  const rowsChangeRef = useRef<{
    previousOffset: number;
    previousTotal: number;
    hold: RowHold | null;
  } | null>(null);
  if (rowsRef.current !== rows) {
    const previous = virtualizerRef.current;
    if (previous?.scrollElement) {
      // A reader following the live edge keeps their distance from it, which
      // is what the scroller does on its own. Anyone else keeps their row.
      const follows =
        !hold && distanceFromEndRef.current <= STICK_TO_BOTTOM_NEAR_PX;
      rowsChangeRef.current = {
        previousOffset: previous.scrollOffset ?? 0,
        previousTotal: previous.getTotalSize(),
        hold: follows
          ? null
          : rowHoldAfterRowsChange(previous, rowsRef.current, rows),
      };
    }
    rowsRef.current = rows;
  }

  // Where the reader is relative to the live edge, from the scroller itself.
  // Called on every scroll and every virtualizer change: chrome that resizes
  // the scroller and rows that grow both move the edge with no scroll event.
  const recordDistance = (element: HTMLElement) => {
    const distance = Math.max(-element.scrollTop, 0);
    distanceFromEndRef.current = distance;
    setAtEnd(distance <= STICK_TO_BOTTOM_NEAR_PX);
    const instance = virtualizerRef.current;
    if (!instance || restoreRef.current || !positionCallbackRef.current) return;
    const edge = element.getBoundingClientRect();
    // Persist measured DOM coordinates, not estimates that can lag a
    // direct virtualizer layout update by one frame.
    const visible = Array.from(
      element.querySelectorAll<HTMLElement>("[data-index]"),
    )
      .map((node) => ({
        node,
        row: rowsRef.current[Number(node.dataset.index)],
        rect: node.getBoundingClientRect(),
      }))
      .filter(
        ({ row, rect }) =>
          row?.kind === "message" &&
          rect.bottom > edge.top &&
          rect.top < edge.bottom,
      );
    const anchor = visible[0];
    const position: TranscriptPosition = {
      anchorId: anchor?.row.kind === "message" ? anchor.row.message.id : null,
      anchorCreatedAt:
        anchor?.row.kind === "message"
          ? new Date(anchor.row.message.createdAt).getTime()
          : 0,
      offset: anchor ? edge.top - anchor.rect.top : 0,
      atLiveEdge: distance <= STICK_TO_BOTTOM_NEAR_PX,
      visibleMessageIds: visible.flatMap(({ row }) =>
        row.kind === "message" ? [row.message.id] : [],
      ),
    };
    const signature = JSON.stringify(position);
    if (signature !== lastPositionRef.current) {
      lastPositionRef.current = signature;
      positionCallbackRef.current(position);
    }
  };

  // Growth at or below the top edge since the last virtualizer change. A
  // bottom-anchored scroller keeps its distance from the end, so that growth
  // pushes the rows on screen up; `onChange` puts them back.
  const growthBelowRef = useRef(0);
  // Putting them back is a scroll write, and a write during a touch scroll
  // ends its momentum on iOS. While a scroll is under way the list is pulled
  // down by a negative bottom margin instead, which hides the growth past
  // the end of the scroller. Once the scroll is over the margin becomes the
  // write, in one frame, and nothing on screen moves.
  const deferredGrowthRef = useRef(0);
  const touchingRef = useRef(false);
  const settleDeferredGrowth = (instance: TranscriptVirtualizer) => {
    const element = instance.scrollElement;
    const growth = deferredGrowthRef.current;
    if (
      !element ||
      growth === 0 ||
      instance.isScrolling ||
      touchingRef.current
    ) {
      return;
    }
    deferredGrowthRef.current = 0;
    containerRef.current?.style.removeProperty("margin-bottom");
    // At the live edge the hidden growth comes into view instead.
    if (!isAtLiveEdge(element)) {
      element.scrollTop -= growth;
    }
    instance.scrollOffset = topOffsetOf(element);
  };
  /** Undo a push up of the rows on screen by `pushedUp` px. */
  const keepRowsInPlace = (
    element: HTMLElement,
    pushedUp: number,
    scrolling: boolean,
  ) => {
    if (pushedUp === 0) {
      return;
    }
    if (!scrolling && !touchingRef.current) {
      element.scrollTop -= pushedUp;
      return;
    }
    deferredGrowthRef.current += pushedUp;
    containerRef.current?.style.setProperty(
      "margin-bottom",
      `${-deferredGrowthRef.current}px`,
    );
  };

  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: (index) =>
      estimateTranscriptRowHeight(
        rows[index],
        scroller
          ? {
              listWidth: scroller.clientWidth,
              viewportWidth: window.innerWidth,
            }
          : undefined,
      ),
    getItemKey: (index) => {
      const row = rows[index];
      return row ? transcriptRowKey(row) : index;
    },
    rangeExtractor: transcriptRangeExtractor,
    observeElementOffset: observeBottomAnchoredOffset,
    scrollToFn: scrollBottomAnchored,
    scrollMargin,
    anchorTo: "end",
    followOnAppend: !hold,
    // A hold also stops a growing row from pulling the view to the end. Only
    // a view already exactly at the end keeps following growth then.
    scrollEndThreshold: hold ? 0 : STICK_TO_BOTTOM_NEAR_PX,
    // The end of a scroll from the browser, where it has it. The fallback
    // is a timer that re-reports the offset it saw at the last scroll event,
    // and that stale offset lands on top of a hold set in between.
    useScrollendEvent: true,
    // Row positions are written to the DOM as they change, so the re-render
    // a measurement triggers need not be flushed inside the commit that
    // measured it: React refuses that flush and warns.
    directDomUpdates: true,
    useFlushSync: false,
    onChange: (instance) => {
      const element = instance.scrollElement;
      if (!element) {
        return;
      }
      const growth = growthBelowRef.current;
      growthBelowRef.current = 0;
      // The distance is still the one from before the growth. A reader
      // following the live edge keeps it; anyone else keeps their rows. Under
      // a hold only a view on the edge itself follows a growing row, while a
      // changed row list (above) is followed by no one.
      const follows = hold
        ? isAtLiveEdge(element)
        : -element.scrollTop <= STICK_TO_BOTTOM_NEAR_PX;
      if (!follows) {
        keepRowsInPlace(element, growth, instance.isScrolling);
      }
      settleDeferredGrowth(instance);
      // The list's height changed with no scroll event, and with it the
      // top-based offset of a view that did not move.
      instance.scrollOffset = topOffsetOf(element);
      recordDistance(element);
    },
  });
  // An instance property, not an option: as an option it is ignored. The
  // virtualizer asks before it puts the view back after a row changed height.
  // It never has to: growth above the view does not move a bottom-anchored
  // scroller. Growth at or below the top edge does, and is noted here.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
    item,
    delta,
    instance,
  ) => {
    const offset = instance.scrollOffset ?? 0;
    // A row measured for the first time grows from its top edge down; one
    // measured again (a streaming message) grows at its bottom.
    const above = instance.itemSizeCache.has(item.key)
      ? item.end <= offset
      : item.start < offset;
    if (!above) {
      growthBelowRef.current += delta;
    }
    return false;
  };
  virtualizerRef.current = virtualizer;

  useEffect(() => {
    if (!scroller) {
      return;
    }
    const record = () => {
      recordDistance(scroller);
    };
    let grace: number | undefined;
    const onTouchStart = () => {
      window.clearTimeout(grace);
      touchingRef.current = true;
    };
    // Dragging the transcript means reading, not typing, so the keyboard
    // gets out of the way. On `touchmove` rather than `scroll`: closing the
    // keyboard resizes the viewport, which scrolls a bottom-anchored
    // scroller, which would blur again on every keyboard open.
    const onTouchMove = () => {
      const active = document.activeElement;
      // Only the composer below the transcript. An editor inside the
      // scroller is an in-row message edit, and scrolling back through the
      // conversation is part of writing that edit, not a reason to end it.
      if (
        active instanceof HTMLElement &&
        active.matches(EDITOR_SELECTOR) &&
        !scroller.contains(active)
      ) {
        active.blur();
      }
    };
    const onTouchEnd = () => {
      window.clearTimeout(grace);
      grace = window.setTimeout(() => {
        touchingRef.current = false;
        settleDeferredGrowth(virtualizer);
      }, TOUCH_END_GRACE_MS);
    };
    scroller.addEventListener("scroll", record, { passive: true });
    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: true });
    scroller.addEventListener("touchend", onTouchEnd, { passive: true });
    scroller.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.clearTimeout(grace);
      scroller.removeEventListener("scroll", record);
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [scroller, virtualizer]);

  // Every render: the container moves whenever a short list grows toward
  // the scroller's height, and the state guard makes a settled margin free.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!scroller || !container) {
      return;
    }
    const margin = Math.round(
      container.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        topOffsetOf(scroller),
    );
    if (margin !== scrollMargin) {
      setScrollMargin(margin);
    }
  });

  // The offset is set before this render's rows mount, so the rows that
  // mount are the ones the reader will see. With a held row it is that row's
  // new position, and the scroller is written once the list has its new
  // height. Without one the scroller has not moved.
  const rowsChange = rowsChangeRef.current;
  const writeScrollRef = useRef(false);
  if (rowsChange) {
    rowsChangeRef.current = null;
    // Refreshes the measurements cache for this render's rows.
    const total = virtualizer.getTotalSize();
    const rowHold = rowsChange.hold;
    const item = rowHold
      ? virtualizer.measurementsCache[
          rows.findIndex((row) => transcriptRowKey(row) === rowHold.key)
        ]
      : undefined;
    if (rowHold && item) {
      virtualizer.scrollOffset = Math.max(item.start + rowHold.offset, 0);
      writeScrollRef.current = true;
    } else {
      virtualizer.scrollOffset =
        rowsChange.previousOffset + total - rowsChange.previousTotal;
    }
  }
  let restoreIndex = -1;
  if (
    restoreRef.current &&
    !restoringRef.current &&
    scroller &&
    rows.length > 0
  ) {
    const saved = restoreRef.current;
    const index = retainedPositionIndex(rows, saved);
    restoreIndex = index;
    virtualizer.getTotalSize();
    const item = virtualizer.measurementsCache[index];
    if (!saved.atLiveEdge && item) {
      virtualizer.scrollOffset = Math.max(item.start + saved.offset, 0);
      distanceFromEndRef.current = Infinity;
      writeScrollRef.current = true;
    }
  }
  useLayoutEffect(() => {
    const saved = restoreRef.current;
    if (saved && !restoringRef.current && scroller && rows.length > 0) {
      // DOM observers initially report the new scroller's live edge. An
      // index target survives their first measurements; a numeric offset
      // can be clamped to the transient DOM height and lose the anchor.
      restoringRef.current = true;
      writeScrollRef.current = false;
      if (saved.atLiveEdge || restoreIndex < 0) {
        restoreRef.current = undefined;
        virtualizer.scrollToEnd();
      } else {
        virtualizer.scrollToIndex(restoreIndex, { align: "start" });
        const landing = ++landingRef.current;
        let frames = 0;
        let settledFrames = 0;
        const finishRestore = () => {
          if (landing !== landingRef.current) return;
          // Reconciliation may insert/delete rows while the landing settles.
          // Resolve identity each frame instead of following a stale index.
          const index = retainedPositionIndex(rowsRef.current, saved);
          const anchor = scroller.querySelector<HTMLElement>(
            `[data-index="${index}"]`,
          );
          if (!anchor && index >= 0 && index !== restoreIndex) {
            virtualizer.scrollToIndex(index, { align: "start" });
          }
          const correction = anchor
            ? anchor.getBoundingClientRect().top -
              scroller.getBoundingClientRect().top +
              saved.offset
            : null;
          if (correction != null && Math.abs(correction) >= 1) {
            growthBelowRef.current = 0;
            virtualizer.scrollBy(correction);
            settledFrames = 0;
          } else {
            settledFrames = correction == null ? 0 : settledFrames + 1;
          }
          // Hold the measured anchor through late row sizing and the
          // virtualizer's index reconciliation before publishing position.
          if (settledFrames < 3 && ++frames < LANDING_FRAMES) {
            requestAnimationFrame(finishRestore);
            return;
          }
          restoreRef.current = undefined;
          recordDistance(scroller);
        };
        requestAnimationFrame(finishRestore);
      }
      return;
    }
    if (!writeScrollRef.current || !scroller) {
      return;
    }
    writeScrollRef.current = false;
    // Rows that only changed above the held one leave it where it is.
    const target = (virtualizer.scrollOffset ?? 0) - maxScrollOf(scroller);
    keepRowsInPlace(
      scroller,
      Math.round(scroller.scrollTop - target),
      virtualizer.isScrolling,
    );
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: () => {
        restoreRef.current = undefined;
        landingRef.current += 1;
        setHeld(false);
        virtualizer.scrollToEnd();
      },
      pinToBottomAfterOwnSend: () => {
        restoreRef.current = undefined;
        landingRef.current += 1;
        // Immediate + rAF: the appended row commits after this call, and the
        // rAF puts the view on it once it exists.
        virtualizer.scrollToEnd();
        requestAnimationFrame(() => {
          virtualizer.scrollToEnd();
        });
      },
      suppressStickToBottom: () => {
        restoreRef.current = undefined;
        landingRef.current += 1;
        setHeld(true);
      },
      releaseStickToBottomSuppress: () => {
        setHeld(false);
      },
      landOnMessage: (messageId) => {
        restoreRef.current = undefined;
        const index = findTranscriptRowIndex(rowsRef.current, messageId);
        if (index < 0) {
          return false;
        }
        landingRef.current += 1;
        const landing = landingRef.current;
        virtualizer.scrollToIndex(index, { align: "center" });
        // The row mounts a render after the scroll. Poll frames for it; a
        // later landing replaces this one, which stops the poll.
        let frames = 0;
        const tryMark = () => {
          if (landing !== landingRef.current) {
            return;
          }
          if (highlightListMessage(list, messageId)) {
            return;
          }
          frames += 1;
          if (frames < LANDING_FRAMES) {
            requestAnimationFrame(tryMark);
          }
        };
        requestAnimationFrame(tryMark);
        return true;
      },
      scrollToMessage: (messageId) => {
        restoreRef.current = undefined;
        landingRef.current += 1;
        const index = findTranscriptRowIndex(rowsRef.current, messageId);
        if (index < 0) {
          return false;
        }
        virtualizer.scrollToIndex(index, {
          align: "center",
          behavior: "smooth",
        });
        return true;
      },
    }),
    [list, virtualizer],
  );

  // Stable: an inline callback is detached and reattached on every render,
  // and the virtualizer rewrites the container's height each time.
  const attachContainer = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      virtualizer.containerRef(node);
    },
    [virtualizer],
  );

  const t = useTranslations("App.Channels");

  if (!scroller) {
    return null;
  }

  return (
    <ClampedOverflowProvider>
      <div ref={attachContainer} className="relative w-full">
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) {
            return null;
          }
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="absolute top-0 left-0 w-full"
            >
              {renderRow(row)}
            </div>
          );
        })}
      </div>
      {/* A zero-height sticky line at the end of the list: it takes no room
          from the transcript, and the control hangs above it, pinned over
          the bottom of the scroller while the reader is anywhere above. */}
      {atEnd ? null : (
        <div className="pointer-events-none sticky bottom-3 z-10 h-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-primary border-primary-tertiary bg-background hover:bg-primary-quaternary hover:text-foreground dark:bg-background dark:hover:bg-primary-quaternary pointer-events-auto absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full shadow-md"
            onClick={() => {
              setHeld(false);
              virtualizer.scrollToEnd();
            }}
          >
            <ArrowDown aria-hidden />
            {t("jumpToLatest")}
          </Button>
        </div>
      )}
    </ClampedOverflowProvider>
  );
}
