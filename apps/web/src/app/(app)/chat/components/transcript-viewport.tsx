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
 * Finish a virtualizer scroll the browser clamped because a row grew
 * before the rows below it moved. Larger than any one row we expect to
 * measure in a single frame (the old 2400px overscan-above window). A
 * bigger DOM gap is a reader who left the end with a stale offset, not
 * growth — do not snap them back.
 */
const CLAMPED_SCROLL_FINISH_MAX_PX = 2400;

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

interface TranscriptViewportProps {
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

/** What the hold below needs from the virtualizer, before the rows change. */
type RowHoldSource = Pick<
  Virtualizer<HTMLElement, HTMLDivElement>,
  "scrollOffset" | "getVirtualItemForOffset" | "measurementsCache"
>;

/** A row to put back where it was once the rows around it have changed. */
export interface RowHold {
  key: string;
  /** Scroll offset minus the row's start: where the top edge sat in the row. */
  offset: number;
}

function transcriptRangeExtractor(range: Range): number[] {
  const start = Math.max(range.startIndex - OVERSCAN_ROWS.above, 0);
  const end = Math.min(range.endIndex + OVERSCAN_ROWS.below, range.count - 1);
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

/**
 * The virtualizer holds the row under the top edge by key when rows change
 * above it. That fails when the row under the edge is the one that changed:
 * a boundary row is replaced by the page it loaded, or removed once history
 * is exhausted. Then the first row below it that survived is held instead,
 * the way the reader sees it: the messages they were reading stay put.
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
  if (nextKeys.has(String(edgeItem.key))) {
    return null;
  }
  const survivorIndex = previousRows.findIndex(
    (row, index) =>
      index > edgeItem.index && nextKeys.has(transcriptRowKey(row)),
  );
  const survivor = virtualizer.measurementsCache[survivorIndex];
  if (!survivor) {
    return null;
  }
  // Never above the survivor: the rows between the edge and it are new and
  // still estimated, and a row that straddles the edge is not compensated
  // when it is measured, so the survivor would drift by their error.
  return {
    key: String(survivor.key),
    offset: Math.max(scrollOffset - survivor.start, 0),
  };
}

/**
 * A transcript, mounting only the rows near the viewport.
 *
 * The virtualizer owns which rows exist, how tall they are, holding the
 * reader's row still while history loads above it, and following new rows
 * at the live edge. This component owns the hold a jump takes on that
 * follow, and landing on a message the reader was sent to. Remount it (key
 * by room or thread parent) to open on the newest message.
 */
export function TranscriptViewport({
  scroller,
  rows,
  renderRow,
  list = CHAT_MESSAGE_LIST_ROOM,
  holdOffBottom,
  ref,
}: TranscriptViewportProps) {
  // A prop of the virtualizer rather than a ref: it decides per render
  // whether an append pulls the view down. A jump that merges a window while
  // the reader sits at the live edge would otherwise be undone by that pull.
  const [held, setHeld] = useState(false);
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
  const virtualizerRef = useRef<Virtualizer<
    HTMLElement,
    HTMLDivElement
  > | null>(null);
  const rowsRef = useRef(rows);
  const rowHoldRef = useRef<RowHold | null>(null);
  // Prepend does not change the last key, so followOnAppend never runs.
  // A short list at the live edge has the boundary under the top edge;
  // holding that row would drop the newest off the bottom. Only a view
  // exactly at the end is put back there: a reader a little above it who
  // gets a refreshed copy of the same rows would otherwise be snapped down.
  const pinToEndAfterRowsChangeRef = useRef(false);
  if (rowsRef.current !== rows) {
    const pinToEnd = !hold && distanceFromEndRef.current < 1;
    rowHoldRef.current =
      !pinToEnd && virtualizerRef.current?.scrollElement
        ? rowHoldAfterRowsChange(virtualizerRef.current, rowsRef.current, rows)
        : null;
    pinToEndAfterRowsChangeRef.current = pinToEnd;
    rowsRef.current = rows;
  }

  // Where the reader is relative to the live edge, from the scroller itself.
  // Called on every scroll and every virtualizer change: a scroll the
  // virtualizer issues can land short without any scroll event (below),
  // and the flags must not say "away from the end" while the view is on it.
  const recordDistance = (element: HTMLElement) => {
    const distance =
      element.scrollHeight - element.clientHeight - element.scrollTop;
    distanceFromEndRef.current = distance;
    setAtEnd(distance <= STICK_TO_BOTTOM_NEAR_PX);
  };

  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: (index) =>
      estimateTranscriptRowHeight(rows[index], scroller?.clientWidth),
    getItemKey: (index) => {
      const row = rows[index];
      return row ? transcriptRowKey(row) : index;
    },
    rangeExtractor: transcriptRangeExtractor,
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
      // When a row grows while the view is at the end, the virtualizer
      // scrolls by the growth before the rows below it are moved down, so
      // the browser clamps that scroll and no scroll event reports it. The
      // virtualizer then believes it is at the end while the scroller is
      // short by the growth. The rows are in place by now: finish the
      // scroll only when the gap is growth-sized. Any larger mismatch is
      // a reader who left the end with a stale offset.
      const max = element.scrollHeight - element.clientHeight;
      const shortBy = max - element.scrollTop;
      if (
        !instance.isScrolling &&
        (instance.scrollOffset ?? 0) >= max - 1 &&
        shortBy > 1 &&
        shortBy <= CLAMPED_SCROLL_FINISH_MAX_PX
      ) {
        element.scrollTop = max;
      }
      recordDistance(element);
    },
  });
  virtualizerRef.current = virtualizer;

  useEffect(() => {
    if (!scroller) {
      return;
    }
    const record = () => {
      recordDistance(scroller);
    };
    scroller.addEventListener("scroll", record, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", record);
    };
  }, [scroller]);

  // The scroller changes height when the composer grows or shrinks, the
  // keyboard opens, or the window resizes. The browser keeps the top edge
  // still through that, which slides the live edge under the composer. A
  // reader near the end keeps their distance from it instead.
  useEffect(() => {
    if (!scroller) {
      return;
    }
    let height = scroller.clientHeight;
    const observer = new ResizeObserver(() => {
      const next = scroller.clientHeight;
      if (next === height) {
        return;
      }
      // Where the reader was before the change, from the height before it:
      // the recorded distance may already have been refreshed by another
      // observer in this same delivery. A scroller that grew while the view
      // was at the end had its scroll clamped by the browser already, which
      // reads as the growth; that reader was at the end.
      const clamped =
        next > height && scroller.scrollTop >= scroller.scrollHeight - next - 1;
      const before = clamped
        ? 0
        : scroller.scrollHeight - height - scroller.scrollTop;
      height = next;
      if (before <= STICK_TO_BOTTOM_NEAR_PX) {
        const offset = scroller.scrollHeight - next - before;
        // The virtualizer learns of a scroll from the event a frame later.
        // A row it measures before then would be compensated against the
        // old offset and undo this write, so it is told the offset now.
        virtualizer.scrollOffset = offset;
        scroller.scrollTop = offset;
        recordDistance(scroller);
      }
    });
    observer.observe(scroller);
    return () => {
      observer.disconnect();
    };
  }, [scroller, virtualizer]);

  // Every render: the container moves whenever a short list grows toward
  // the scroller's height, and the state guard makes a settled margin free.
  // Open on the newest message once the margin is settled, not before: a
  // scroll to the end issued with a margin still unknown lands short of it.
  const openedRef = useRef(false);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!scroller || !container) {
      return;
    }
    const margin = Math.round(
      container.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop,
    );
    if (margin !== scrollMargin) {
      setScrollMargin(margin);
      return;
    }
    if (!openedRef.current) {
      openedRef.current = true;
      pinToEndAfterRowsChangeRef.current = false;
      virtualizer.scrollToEnd();
      return;
    }
    if (pinToEndAfterRowsChangeRef.current) {
      pinToEndAfterRowsChangeRef.current = false;
      virtualizer.scrollToEnd();
    }
  });

  // The held row is put back the way the virtualizer puts back its own: the
  // offset is set before this render's rows mount, so every row measured
  // above the top edge on mount is compensated against the right position,
  // and the scroller is written once they have been. A scroll issued after
  // the mount would race those corrections.
  const rowHold = rowHoldRef.current;
  const writeScrollRef = useRef(false);
  if (rowHold) {
    rowHoldRef.current = null;
    const index = rows.findIndex(
      (row) => transcriptRowKey(row) === rowHold.key,
    );
    // Refreshes the measurements cache for this render's rows.
    virtualizer.getTotalSize();
    const item = virtualizer.measurementsCache[index];
    if (item) {
      virtualizer.scrollOffset = item.start + rowHold.offset;
      writeScrollRef.current = true;
    }
  }
  useLayoutEffect(() => {
    if (!writeScrollRef.current || !scroller) {
      return;
    }
    writeScrollRef.current = false;
    scroller.scrollTop = virtualizer.scrollOffset ?? 0;
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: () => {
        setHeld(false);
        virtualizer.scrollToEnd();
      },
      pinToBottomAfterOwnSend: () => {
        // Immediate + rAF: the appended row commits after this call, and the
        // rAF puts the view on it once it exists.
        virtualizer.scrollToEnd();
        requestAnimationFrame(() => {
          virtualizer.scrollToEnd();
        });
      },
      suppressStickToBottom: () => {
        setHeld(true);
      },
      releaseStickToBottomSuppress: () => {
        setHeld(false);
      },
      landOnMessage: (messageId) => {
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
