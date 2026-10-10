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

function transcriptRangeExtractor(range: Range): number[] {
  const start = Math.max(range.startIndex - OVERSCAN_ROWS.above, 0);
  const end = Math.min(range.endIndex + OVERSCAN_ROWS.below, range.count - 1);
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
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
 * new rows at the live edge. This component owns saved reading positions,
 * jump holds and landings. Remount per room or thread parent.
 */
export function TranscriptViewport({
  scroller,
  rows: incomingRows,
  renderRow,
  list = CHAT_MESSAGE_LIST_ROOM,
  holdOffBottom,
  initialPosition,
  onPositionChange,
  ref,
}: TranscriptViewportProps) {
  const scrollingRef = useRef(false);
  const touchingRef = useRef(false);
  const deferredRef = useRef(false);
  const displayedRowsRef = useRef(incomingRows);
  const projectedInputRef = useRef(incomingRows);
  const [, releasePage] = useState(0);
  // Project only data changes or a settled page, never each virtual range update.
  if (
    projectedInputRef.current !== incomingRows ||
    (deferredRef.current && (!scrollingRef.current || holdOffBottom))
  ) {
    let rows = incomingRows;
    if (scrollingRef.current && !holdOffBottom) {
      const previous = displayedRowsRef.current;
      const latest = new Map(
        incomingRows.map((row) => [transcriptRowKey(row), row]),
      );
      const first = previous.find(
        (row) => row.kind === "message" && latest.has(transcriptRowKey(row)),
      );
      const firstIndex = first
        ? incomingRows.findIndex(
            (row) => transcriptRowKey(row) === transcriptRowKey(first),
          )
        : -1;
      const prepended = incomingRows
        .slice(0, firstIndex)
        .some((row) => row.kind === "message");
      if (firstIndex >= 0 && (deferredRef.current || prepended)) {
        // Keep the order being scrolled. Existing messages still receive edits
        // and streaming chunks; new live messages can still append below it.
        const last = previous.findLast(
          (row) => row.kind === "message" && latest.has(transcriptRowKey(row)),
        );
        const lastIndex = last
          ? incomingRows.findIndex(
              (row) => transcriptRowKey(row) === transcriptRowKey(last),
            )
          : -1;
        rows = [
          ...previous.flatMap((row) => {
            const updated = latest.get(transcriptRowKey(row));
            return updated ? [updated] : row.kind === "boundary" ? [row] : [];
          }),
          ...incomingRows.slice(lastIndex + 1),
        ];
        deferredRef.current = true;
      }
    }
    if (rows === incomingRows) deferredRef.current = false;
    displayedRowsRef.current = rows;
    projectedInputRef.current = incomingRows;
  }
  const rows = displayedRowsRef.current;

  // A prop of the virtualizer rather than a ref: it decides per render
  // whether an append pulls the view down. A jump that merges a window while
  // the reader sits at the live edge would otherwise be undone by that pull.
  const [held, setHeld] = useState(
    Boolean(initialPosition && !initialPosition.atLiveEdge),
  );
  const restoreRef = useRef(initialPosition);
  const openedRef = useRef(false);
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

  // Only the jump-to-latest threshold needs React state.
  const [atEnd, setAtEnd] = useState(true);
  const distanceFromEndRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const virtualizerRef = useRef<TranscriptVirtualizer | null>(null);
  const rowsRef = useRef(rows);
  if (rowsRef.current !== rows) {
    const previous = virtualizerRef.current;
    const edge = previous?.getVirtualItemForOffset(previous.scrollOffset ?? 0);
    // A page replaces its loading boundary. TanStack cannot retain a key
    // that disappeared; retain the first surviving row below it instead.
    if (
      edge &&
      previous &&
      !rows.some((row) => transcriptRowKey(row) === edge.key)
    ) {
      const nextKeys = new Set(rows.map(transcriptRowKey));
      const survivor = rowsRef.current.findIndex(
        (row, index) =>
          index > edge.index &&
          row.kind === "message" &&
          nextKeys.has(transcriptRowKey(row)),
      );
      const element = previous.scrollElement;
      const node = element?.querySelector<HTMLElement>(
        `[data-index="${survivor}"]`,
      );
      const row = rowsRef.current[survivor];
      if (element && node && row?.kind === "message") {
        restoreRef.current = {
          anchorId: row.message.id,
          anchorCreatedAt: new Date(row.message.createdAt).getTime(),
          offset:
            element.getBoundingClientRect().top -
            node.getBoundingClientRect().top,
          atLiveEdge: previous.isAtEnd(hold ? 0 : STICK_TO_BOTTOM_NEAR_PX),
          visibleMessageIds: [],
        };
        openedRef.current = false;
      }
    }
    rowsRef.current = rows;
  }

  // Where the reader is relative to the live edge, from the scroller itself.
  // Called on every scroll and every virtualizer change: chrome that resizes
  // the scroller and rows that grow both move the edge with no scroll event.
  const recordDistance = (element: HTMLElement) => {
    const distance = Math.max(
      element.scrollHeight - element.clientHeight - element.scrollTop,
      0,
    );
    distanceFromEndRef.current = distance;
    setAtEnd(distance <= STICK_TO_BOTTOM_NEAR_PX);
    if (restoreRef.current || !positionCallbackRef.current) return;
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

  const getItemKey = useCallback(
    (index: number) => {
      const row = rows[index];
      return row ? transcriptRowKey(row) : index;
    },
    [rows],
  );
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
    getItemKey,
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
      const height = instance.scrollRect?.height ?? 0;
      const previousHeight = viewportHeightRef.current;
      viewportHeightRef.current = height;
      // Composer/keyboard resizing keeps the distance from the end for a
      // reader following latest. History keeps its normal top offset.
      if (
        previousHeight &&
        height !== previousHeight &&
        distanceFromEndRef.current <= (hold ? 0 : STICK_TO_BOTTOM_NEAR_PX)
      ) {
        instance.scrollToOffset(
          (instance.scrollOffset ?? 0) + previousHeight - height,
        );
      }
      recordDistance(element);
    },
  });
  virtualizerRef.current = virtualizer;
  useEffect(() => {
    if (!scroller) {
      return;
    }
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(idleTimer);
      if (touchingRef.current) return;
      // Match TanStack's iOS post-touch grace before changing row positions.
      // Scroll events keep renewing this timer throughout momentum scrolling.
      idleTimer = setTimeout(() => {
        if (virtualizer.isScrolling) {
          settle();
          return;
        }
        scrollingRef.current = false;
        if (deferredRef.current) releasePage((version) => version + 1);
      }, 200);
    };
    const record = () => {
      scrollingRef.current = true;
      recordDistance(scroller);
      settle();
    };
    const touchStart = () => {
      touchingRef.current = true;
      scrollingRef.current = true;
      clearTimeout(idleTimer);
    };
    const touchEnd = () => {
      touchingRef.current = false;
      settle();
    };
    // Dragging the transcript means reading, not typing, so the keyboard
    // gets out of the way. On `touchmove` rather than `scroll`: closing the
    // keyboard changes the viewport and can itself emit scroll events.
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
    scroller.addEventListener("scroll", record, { passive: true });
    scroller.addEventListener("scrollend", settle, { passive: true });
    scroller.addEventListener("touchstart", touchStart, { passive: true });
    scroller.addEventListener("touchend", touchEnd, { passive: true });
    scroller.addEventListener("touchcancel", touchEnd, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      clearTimeout(idleTimer);
      scroller.removeEventListener("scroll", record);
      scroller.removeEventListener("scrollend", settle);
      scroller.removeEventListener("touchstart", touchStart);
      scroller.removeEventListener("touchend", touchEnd);
      scroller.removeEventListener("touchcancel", touchEnd);
      scroller.removeEventListener("touchmove", onTouchMove);
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
        scroller.scrollTop,
    );
    if (margin !== scrollMargin) {
      setScrollMargin(margin);
    }
  });

  useLayoutEffect(() => {
    if (openedRef.current || !scroller || rows.length === 0) return;
    openedRef.current = true;
    const saved = restoreRef.current;
    const index = saved ? retainedPositionIndex(rows, saved) : -1;
    if (!saved || saved.atLiveEdge || index < 0) {
      restoreRef.current = undefined;
      virtualizer.scrollToEnd();
      return;
    }
    virtualizer.scrollToIndex(index, { align: "start" });
    const landing = ++landingRef.current;
    let frames = 0;
    let settledFrames = 0;
    const finishRestore = () => {
      if (landing !== landingRef.current) return;
      const currentIndex = retainedPositionIndex(rowsRef.current, saved);
      const anchor = scroller.querySelector<HTMLElement>(
        `[data-index="${currentIndex}"]`,
      );
      if (!anchor && currentIndex >= 0 && currentIndex !== index) {
        virtualizer.scrollToIndex(currentIndex, { align: "start" });
      }
      const correction = anchor
        ? anchor.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          saved.offset
        : null;
      if (correction != null && Math.abs(correction) >= 1) {
        virtualizer.scrollBy(correction);
        settledFrames = 0;
      } else {
        settledFrames = correction == null ? 0 : settledFrames + 1;
      }
      if (settledFrames < 3 && ++frames < LANDING_FRAMES) {
        requestAnimationFrame(finishRestore);
        return;
      }
      restoreRef.current = undefined;
      recordDistance(scroller);
    };
    requestAnimationFrame(finishRestore);
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
