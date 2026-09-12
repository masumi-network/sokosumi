"use client";

import {
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
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
} from "@/app/chat/utils/transcript-scroll-anchor";
import {
  findTranscriptRowIndex,
  firstItemIndexAfterRowsChange,
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

/** How many frames a landing waits for its row to mount after the scroll. */
const LANDING_FRAMES = 12;

export interface TranscriptViewportAnchor {
  messageId: string;
  /** Distance from the scroller's top edge to the row's top edge. */
  offset: number;
  /** Row index at capture, so a restore can tell what was inserted above. */
  index: number;
}

export interface TranscriptViewportHandle {
  /** Live edge, whatever the reader was doing. */
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
  /** What the reader is looking at, taken before rows change above it. */
  captureAnchor: (
    fallbackMessageId?: string,
  ) => TranscriptViewportAnchor | null;
  /** Put the anchored row back where it was, after the rows changed. */
  restoreAnchor: (anchor: TranscriptViewportAnchor) => void;
}

interface TranscriptViewportProps {
  /** The native overflow scroller the list lives in. */
  scrollerRef: RefObject<HTMLElement | null>;
  rows: readonly RoomTranscriptRenderRow[];
  renderRow: (row: RoomTranscriptRenderRow) => ReactNode;
  /** Search jump: do not follow new messages while landing on an older hit. */
  holdOffBottom: boolean;
  ref: Ref<TranscriptViewportHandle>;
}

interface TrackedRows {
  rows: readonly RoomTranscriptRenderRow[];
  firstItemIndex: number;
  /** Rows inserted above the first surviving row by the latest change. */
  insertedAbove: number;
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
  scrollerRef,
  rows,
  renderRow,
  holdOffBottom,
  ref,
}: TranscriptViewportProps) {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  // Virtuoso wants the scroll parent as an element, which exists only after
  // the shell has mounted; syncing it once is the external-DOM case.
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setScroller(scrollerRef.current);
  }, [scrollerRef]);

  // Rows and firstItemIndex have to change in the same render for Virtuoso
  // to keep the viewport still, so the shift is derived here rather than in
  // an effect.
  const [tracked, setTracked] = useState<TrackedRows>(() => ({
    rows,
    firstItemIndex: TRANSCRIPT_FIRST_ITEM_INDEX_START,
    insertedAbove: 0,
  }));
  if (tracked.rows !== rows) {
    const firstItemIndex = firstItemIndexAfterRowsChange({
      previousRows: tracked.rows,
      nextRows: rows,
      previousFirstItemIndex: tracked.firstItemIndex,
    });
    setTracked({
      rows,
      firstItemIndex,
      insertedAbove: tracked.firstItemIndex - firstItemIndex,
    });
  }
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const trackedRef = useRef(tracked);
  trackedRef.current = tracked;

  const atBottomRef = useRef(true);
  // A prop rather than a ref: Virtuoso re-pins on its own when the list grows
  // while at the bottom, and only `followOutput={false}` turns that off. A
  // jump that merges a window while the reader sits at the live edge would
  // otherwise be undone by that re-pin.
  const [held, setHeld] = useState(false);
  const landingRef = useRef(0);

  const scrollToLast = useCallback((behavior: "auto" | "smooth" = "auto") => {
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior,
    });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: () => {
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
        // The row mounts a render after the scroll. Poll a few frames for it;
        // a later landing replaces this one, which stops the poll.
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
        const node = scrollerRef.current;
        if (!node) {
          return null;
        }
        const anchor =
          captureVisibleTranscriptScrollAnchor(node) ??
          (fallbackMessageId
            ? captureTranscriptScrollAnchor(node, fallbackMessageId)
            : null);
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
        // Rows inserted above the first row were absorbed by firstItemIndex;
        // Virtuoso already held the viewport for those. Anything inserted
        // between the first row and the anchor (a gap fill) still moved it.
        if (index - anchor.index === trackedRef.current.insertedAbove) {
          return;
        }
        virtuosoRef.current?.scrollToIndex({
          index,
          align: "start",
          offset: -anchor.offset,
        });
      },
    }),
    [scrollToLast, scrollerRef],
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
    />
  );
}
