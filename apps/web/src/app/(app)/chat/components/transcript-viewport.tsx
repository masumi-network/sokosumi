"use client";

import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { STICK_TO_BOTTOM_NEAR_PX } from "@/app/chat/hooks/use-stick-to-bottom";
import { highlightRoomTranscriptMessage } from "@/app/chat/utils/room-message-highlight";
import type { RoomTranscriptRenderRow } from "@/app/chat/utils/room-transcript-ranges";
import {
  captureTranscriptScrollAnchor,
  captureVisibleTranscriptScrollAnchor,
  type TranscriptScrollAnchor,
} from "@/app/chat/utils/transcript-scroll-anchor";
import {
  findTranscriptRowIndex,
  firstItemIndexAfterRowsChange,
  shouldFollowListGrowth,
  TRANSCRIPT_FIRST_ITEM_INDEX_START,
  transcriptRowKey,
} from "@/app/chat/utils/transcript-viewport-model";

/**
 * Rows rendered beyond the viewport on each side. About one phone screen,
 * so a small scroll or a hover never reaches an unmounted row.
 */
const OVERSCAN_PX = 600;

/** Height assumed for a row until it is measured. */
const DEFAULT_ROW_HEIGHT_PX = 56;

/**
 * How many frames a landing waits for its row to mount after the scroll.
 * Virtuoso re-issues a scroll for up to 1.2 s while rows above the target are
 * still being measured, so the wait covers that.
 */
const LANDING_FRAMES = 90;

export interface TranscriptViewportAnchor extends TranscriptScrollAnchor {
  /** Row index at capture; the restore looks the row up again by id. */
  index: number;
}

export interface TranscriptViewportHandle {
  /** Live edge, whatever the reader was doing. Drops any hold. */
  scrollToBottom: () => void;
  /** Own send: always reveal the new bubble, even after scrolling up. */
  pinToBottomAfterOwnSend: () => void;
  /** Chrome resize: keep the last row in view only when already there. */
  scrollToBottomIfPinned: () => void;
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
  /**
   * What the reader is looking at, taken before rows change above it. Falls
   * back to the named row when nothing is in view.
   */
  captureAnchor: (fallbackMessageId: string) => TranscriptViewportAnchor | null;
  /** Put the anchored row back where it was, after the rows changed. */
  restoreAnchor: (anchor: TranscriptViewportAnchor) => void;
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
  /** Search jump: do not follow new messages while landing on an older hit. */
  holdOffBottom: boolean;
  ref: Ref<TranscriptViewportHandle>;
}

interface TrackedRows {
  rows: readonly RoomTranscriptRenderRow[];
  firstItemIndex: number;
}

/**
 * The room transcript, mounting only the rows near the viewport.
 *
 * Virtuoso owns which rows exist and how tall they are; this component owns
 * what the room needs from the list: the live-edge pin, the hold a jump takes
 * on it, landing on a message the reader was sent to, and holding the
 * reader's row still while history loads above it. Remount it (key by room)
 * to open a new room on its newest message.
 */
export function TranscriptViewport({
  scroller,
  rows,
  renderRow,
  holdOffBottom,
  ref,
}: TranscriptViewportProps) {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);

  // Rows and firstItemIndex have to change in the same render for Virtuoso
  // to keep row sizes with their rows, so the shift is derived here rather
  // than in an effect.
  const [tracked, setTracked] = useState<TrackedRows>(() => ({
    rows,
    firstItemIndex: TRANSCRIPT_FIRST_ITEM_INDEX_START,
  }));
  if (tracked.rows !== rows) {
    setTracked({
      rows,
      firstItemIndex: firstItemIndexAfterRowsChange({
        previousRows: tracked.rows,
        nextRows: rows,
        previousFirstItemIndex: tracked.firstItemIndex,
      }),
    });
  }
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const atBottomRef = useRef(true);
  // A prop rather than a ref: Virtuoso re-pins on its own when the list grows
  // while at the bottom, and only `followOutput={false}` turns that off. A
  // jump that merges a window while the reader sits at the live edge would
  // otherwise be undone by that re-pin.
  const [held, setHeld] = useState(false);
  const heldRef = useRef(held);
  heldRef.current = held;
  const holdOffBottomRef = useRef(holdOffBottom);
  holdOffBottomRef.current = holdOffBottom;
  const landingRef = useRef(0);
  const lastListHeightRef = useRef(0);

  // Scroll anchoring, done by hand. Rows above the viewport mount fresh on
  // every prepend and grow late as their images and unfurls load; Virtuoso
  // compensates for that only while the reader is scrolling upward, and the
  // browser's own anchoring is off inside the list. So the row at the top of
  // the viewport is recorded on every scroll, and put back after the list
  // height changes. Measured from the DOM, so a shift Virtuoso already made
  // good reads as no drift.
  const visibleAnchorRef = useRef<TranscriptScrollAnchor | null>(null);
  useEffect(() => {
    if (!scroller) {
      return;
    }
    const record = () => {
      visibleAnchorRef.current = captureVisibleTranscriptScrollAnchor(scroller);
    };
    record();
    scroller.addEventListener("scroll", record, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", record);
    };
  }, [scroller]);
  const holdVisibleAnchor = useCallback(() => {
    const anchor = visibleAnchorRef.current;
    if (!scroller || !anchor) {
      return;
    }
    const next = captureTranscriptScrollAnchor(scroller, anchor.messageId);
    if (!next) {
      return;
    }
    const drift = next.offset - anchor.offset;
    if (drift !== 0) {
      scroller.scrollTop += drift;
    }
  }, [scroller]);

  const scrollToLast = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end" });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: () => {
        setHeld(false);
        scrollToLast();
      },
      pinToBottomAfterOwnSend: () => {
        // Immediate + rAF: the appended row commits after this call, and the
        // rAF puts the view on it once it exists.
        scrollToLast();
        requestAnimationFrame(() => {
          scrollToLast();
        });
      },
      scrollToBottomIfPinned: () => {
        if (atBottomRef.current) {
          scrollToLast();
        }
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
        virtuosoRef.current?.scrollToIndex({ index, align: "center" });
        // The row mounts a render after the scroll. Poll frames for it; a
        // later landing replaces this one, which stops the poll.
        let frames = 0;
        const tryMark = () => {
          if (landing !== landingRef.current) {
            return;
          }
          if (highlightRoomTranscriptMessage(messageId)) {
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
        virtuosoRef.current?.scrollToIndex({
          index,
          align: "center",
          behavior: "smooth",
        });
        return true;
      },
      captureAnchor: (fallbackMessageId) => {
        if (!scroller) {
          return null;
        }
        const anchor =
          captureVisibleTranscriptScrollAnchor(scroller) ??
          captureTranscriptScrollAnchor(scroller, fallbackMessageId);
        if (!anchor) {
          return null;
        }
        const index = findTranscriptRowIndex(rowsRef.current, anchor.messageId);
        return index < 0 ? null : { ...anchor, index };
      },
      restoreAnchor: (anchor) => {
        const index = findTranscriptRowIndex(rowsRef.current, anchor.messageId);
        if (index < 0) {
          return;
        }
        // Always through scrollToIndex, even when firstItemIndex absorbed the
        // insert. Virtuoso's own compensation for rows that measure taller
        // than their estimate runs only while the reader is scrolling up; a
        // scroll-to-index re-targets itself as those rows settle.
        virtuosoRef.current?.scrollToIndex({
          index,
          align: "start",
          offset: -anchor.offset,
        });
      },
    }),
    [scrollToLast, scroller],
  );

  if (!scroller) {
    return null;
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      customScrollParent={scroller}
      data={tracked.rows}
      firstItemIndex={tracked.firstItemIndex}
      computeItemKey={(_index, row) => transcriptRowKey(row)}
      itemContent={(_index, row) => renderRow(row)}
      defaultItemHeight={DEFAULT_ROW_HEIGHT_PX}
      increaseViewportBy={OVERSCAN_PX}
      initialTopMostItemIndex={{ index: "LAST", align: "end" }}
      atBottomThreshold={STICK_TO_BOTTOM_NEAR_PX}
      atBottomStateChange={(atBottom) => {
        atBottomRef.current = atBottom;
      }}
      followOutput={held || holdOffBottom ? false : "auto"}
      // Virtuoso follows output on its own only when the row count changes.
      // Rows also grow after they mount: a measured row replaces its estimate,
      // an unfurl or image loads. A reader at the live edge before that growth
      // stays there.
      totalListHeightChanged={(height) => {
        const growth = height - lastListHeightRef.current;
        lastListHeightRef.current = height;
        if (
          shouldFollowListGrowth({
            growth,
            held: heldRef.current || holdOffBottomRef.current,
            atBottom: atBottomRef.current,
            distanceFromBottom:
              scroller.scrollHeight -
              scroller.scrollTop -
              scroller.clientHeight,
          })
        ) {
          scrollToLast();
          return;
        }
        // Now, because the grown row is already laid out when its resize is
        // reported, so the frame about to paint is the corrected one. Again
        // next frame, once Virtuoso has re-laid the list and any compensating
        // scroll of its own has refreshed the record, to settle what is left.
        holdVisibleAnchor();
        requestAnimationFrame(holdVisibleAnchor);
      }}
    />
  );
}
