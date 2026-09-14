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

import { CHAT_MESSAGE_LIST_ROOM } from "@/app/chat/chat-message-list";
import { highlightListMessage } from "@/app/chat/utils/room-message-highlight";
import type { RoomTranscriptRenderRow } from "@/app/chat/utils/room-transcript-ranges";
import {
  captureTranscriptScrollAnchor,
  captureVisibleTranscriptScrollAnchor,
  type TranscriptScrollAnchor,
} from "@/app/chat/utils/transcript-scroll-anchor";
import {
  findTranscriptRowIndex,
  firstItemIndexAfterRowsChange,
  STICK_TO_BOTTOM_NEAR_PX,
  shouldFollowListGrowth,
  TRANSCRIPT_FIRST_ITEM_INDEX_START,
  transcriptRowKey,
} from "@/app/chat/utils/transcript-viewport-model";

/**
 * Rows rendered beyond the viewport. Deep above, shallow below: a row is
 * measured when it mounts, and a row that measures taller than its estimate
 * shifts everything under it. Measured while the reader is still reading,
 * that shift is put back before paint; measured while they scroll toward
 * it, it shows. Below the viewport only the live edge needs a buffer.
 */
const OVERSCAN_PX = { top: 2400, bottom: 600 };

/** Height assumed for a row until it is measured: a short text row. */
const DEFAULT_ROW_HEIGHT_PX = 80;

/**
 * Virtuoso answers a prepend with a deferred scroll by its own estimate of
 * the new rows, on top of whatever the restore did. The restore is issued
 * again after that window so it has the last word. A later restore, jump, or
 * unmount clears the pending retry so it cannot scroll to a stale index.
 */
const RESTORE_AFTER_PREPEND_MS = 100;

/**
 * How many frames a landing waits for its row to mount after the scroll.
 * Virtuoso re-issues a scroll for up to 1.2 s while rows above the target are
 * still being measured, so the wait covers that.
 */
const LANDING_FRAMES = 90;

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
  captureAnchor: (fallbackMessageId: string) => TranscriptScrollAnchor | null;
  /** Put the anchored row back where it was, after the rows changed. */
  restoreAnchor: (anchor: TranscriptScrollAnchor) => void;
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

/**
 * A transcript, mounting only the rows near the viewport.
 *
 * Virtuoso owns which rows exist and how tall they are; this component owns
 * what the list needs: the live-edge pin, the hold a jump takes on it,
 * landing on a message the reader was sent to, and holding the reader's row
 * still while history loads above it. Remount it (key by room or thread
 * parent) to open on the newest message.
 */
interface TrackedRows {
  rows: readonly RoomTranscriptRenderRow[];
  firstItemIndex: number;
}

export function TranscriptViewport({
  scroller,
  rows,
  renderRow,
  list = CHAT_MESSAGE_LIST_ROOM,
  holdOffBottom,
  ref,
}: TranscriptViewportProps) {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);

  // Rows and firstItemIndex have to change in the same render for Virtuoso
  // to keep row sizes with their rows across a prepend, so the shift is
  // derived here rather than in an effect.
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
  const restoreTimeoutRef = useRef(0);
  const cancelRestoreRetry = useCallback(() => {
    window.clearTimeout(restoreTimeoutRef.current);
    restoreTimeoutRef.current = 0;
  }, []);
  // Unmount ends a landing still polling for its row, and a prepend restore
  // still waiting to retry.
  useEffect(
    () => () => {
      landingRef.current += 1;
      window.clearTimeout(restoreTimeoutRef.current);
    },
    [],
  );
  const lastListHeightRef = useRef(0);

  // Scroll anchoring, done by hand, for a list at rest. Rows above the
  // viewport mount fresh on every prepend and grow late as their images and
  // unfurls load; Virtuoso compensates for that only while the reader is
  // scrolling, and the browser's own anchoring is off inside the list. So
  // the row at the top of the viewport is recorded on every scroll, and put
  // back after the list height changes. Never while scrolling: Virtuoso is
  // compensating then, in the same pass, and a second correction on top of
  // its own shows as a jump. Measured from the DOM, so a shift Virtuoso
  // already made good reads as no drift.
  const scrollingRef = useRef(false);
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
    if (!scroller || !anchor || scrollingRef.current) {
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
    cancelRestoreRetry();
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end" });
  }, [cancelRestoreRetry]);

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
        cancelRestoreRetry();
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
        cancelRestoreRetry();
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
        return (
          captureVisibleTranscriptScrollAnchor(scroller) ??
          captureTranscriptScrollAnchor(scroller, fallbackMessageId)
        );
      },
      restoreAnchor: (anchor) => {
        cancelRestoreRetry();
        // Look the row up when the restore runs, not when it is scheduled:
        // a second prepend in the 100ms window shifts every index.
        const restore = () => {
          const index = findTranscriptRowIndex(
            rowsRef.current,
            anchor.messageId,
          );
          if (index < 0) {
            return;
          }
          virtuosoRef.current?.scrollToIndex({
            index,
            align: "start",
            offset: -anchor.offset,
          });
        };
        restore();
        restoreTimeoutRef.current = window.setTimeout(
          restore,
          RESTORE_AFTER_PREPEND_MS,
        );
      },
    }),
    [cancelRestoreRetry, list, scrollToLast, scroller],
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
      isScrolling={(scrolling) => {
        scrollingRef.current = scrolling;
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
